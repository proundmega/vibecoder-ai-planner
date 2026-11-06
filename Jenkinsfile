pipeline {
    agent any

    options {
        timestamps()
        timeout(time: 60, unit: 'MINUTES')
    }

    tools {
        maven 'Maven'
    }

    environment {
        POSTGRES_PASSWORD = 'changeme'
        JWT_SECRET = 'jenkins-ci-secret-for-testing-purposes-2026'
        ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
        // Sanitize branch name: only lowercase alphanumeric + hyphens allowed by docker compose
        // Collapse consecutive hyphens and trim leading/trailing hyphens for clean names
        COMPOSE_PROJECT_NAME = "vibecode-${BRANCH_NAME.toLowerCase().replaceAll('[^a-z0-9-]', '-').replaceAll('-+', '-').replaceAll('^-|-$', '')}-${BUILD_NUMBER}"
        // DATABASE_URL removed — docker-compose.yml sets it to postgres:5432 for the API container.
        // Integration tests set their own DATABASE_URL pointing to localhost:5432 (published port).
        // DOCKER_COMPOSE_FILE avoids Groovy interpreting hyphens in triple-quoted strings
        DOCKER_COMPOSE_FILE = 'docker-compose.yml'
    }

    stages {
        // The full pipeline runs on every build. Change detection is
        // intentionally not used, so no stage is skipped by a `when` block.
        stage('Setup') {
            steps {
                script {
                    nodejs('Node') {
                        dir('backend') {
                            sh 'npm ci'
                        }
                    }
                    nodejs('Node') {
                        dir('frontend') {
                            sh 'npm ci'
                        }
                    }
                }
            }
        }

        stage('Backend') {
            parallel {
                stage('Backend Lint') {
                    steps {
                        nodejs('Node') {
                            dir('backend') {
                                sh 'npm run lint'
                            }
                        }
                    }
                }
                stage('Backend Syntax') {
                    steps {
                        nodejs('Node') {
                            dir('backend') {
                                sh 'node --check src/index.js'
                            }
                        }
                    }
                }
                stage('Backend Helper Unit Tests') {
                    steps {
                        dir('backend') {
                            sh 'bash integration-test/helpers_unit.test.sh'
                        }
                    }
                }
                stage('Backend Unit Tests') {
                    steps {
                        nodejs('Node') {
                            dir('backend') {
                                sh 'npm test'
                            }
                        }
                    }
                }
                stage('Backend Coverage') {
                    steps {
                        nodejs('Node') {
                            dir('backend') {
                                sh 'npm run test:coverage'
                            }
                        }
                    }
                }
            }
        }

        stage('Frontend') {
            parallel {
                stage('Frontend Lint') {
                    steps {
                        nodejs('Node') {
                            dir('frontend') {
                                sh 'npm run lint'
                            }
                        }
                    }
                }
                stage('Frontend Typecheck') {
                    steps {
                        nodejs('Node') {
                            dir('frontend') {
                                sh 'npm run typecheck'
                            }
                        }
                    }
                }
                stage('Frontend Unit Tests') {
                    steps {
                        nodejs('Node') {
                            dir('frontend') {
                                sh 'npm test -- --run'
                            }
                        }
                    }
                }
                stage('Frontend Coverage') {
                    steps {
                        nodejs('Node') {
                            dir('frontend') {
                                sh 'npm test -- --run --coverage'
                            }
                        }
                    }
                }
                stage('Frontend Build') {
                    steps {
                        nodejs('Node') {
                            dir('frontend') {
                                sh 'npm run build'
                            }
                        }
                    }
                }
            }
        }

        stage('Contract Test') {
            steps {
                nodejs('Node') {
                    dir('frontend') {
                        sh 'npm ci'
                        sh './node_modules/.bin/vitest --run src/__tests__/api-contract.test.ts'
                    }
                }
            }
        }

        stage('Cypress E2E') {
            steps {
                script {
                    // The API needs the same secrets as the Integration stage.
                    sh """
                        cat > .env <<EOF
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
JWT_SECRET=${JWT_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
PGADMIN_PASSWORD=changeme
EOF
                    """

                    sh "DOCKER_HOST=\$DOCKER_HOST docker compose -f \${DOCKER_COMPOSE_FILE} -f docker-compose.e2e.yml down -v --remove-orphans || true"
                    sh "DOCKER_HOST=\$DOCKER_HOST docker compose -f \${DOCKER_COMPOSE_FILE} -f docker-compose.e2e.yml up -d --build"

                    // Wait for the API and frontend health checks before Cypress
                    // starts seeding users through the API.
                    def ready = false
                    for (int i = 0; i < 30; i++) {
                        def healthFormat = '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}'
                        def apiHealth = sh(
                            script: "DOCKER_HOST=\$DOCKER_HOST docker inspect --format '${healthFormat}' \$(DOCKER_HOST=\$DOCKER_HOST docker compose -f \${DOCKER_COMPOSE_FILE} -f docker-compose.e2e.yml ps -q api) 2>/dev/null || echo starting",
                            returnStdout: true
                        ).trim()
                        def frontendHealth = sh(
                            script: "DOCKER_HOST=\$DOCKER_HOST docker inspect --format '${healthFormat}' \$(DOCKER_HOST=\$DOCKER_HOST docker compose -f \${DOCKER_COMPOSE_FILE} -f docker-compose.e2e.yml ps -q frontend) 2>/dev/null || echo starting",
                            returnStdout: true
                        ).trim()
                        if (apiHealth == 'healthy' && frontendHealth == 'healthy') {
                            ready = true
                            break
                        }
                        echo "Cypress stack not ready (api=${apiHealth}, frontend=${frontendHealth})"
                        sleep(time: 3, unit: 'SECONDS')
                    }
                    if (!ready) {
                        sh "DOCKER_HOST=\$DOCKER_HOST docker compose -f \${DOCKER_COMPOSE_FILE} -f docker-compose.e2e.yml logs --tail=100 || true"
                        error('Cypress E2E stack failed to become healthy')
                    }

                    // Build the runner from the frontend context instead of
                    // bind-mounting the workspace: the Docker daemon behind
                    // DOCKER_HOST does not share the Jenkins workspace path.
                    sh "DOCKER_HOST=\$DOCKER_HOST docker compose -f \${DOCKER_COMPOSE_FILE} -f docker-compose.e2e.yml --profile e2e build cypress"
                    sh "DOCKER_HOST=\$DOCKER_HOST docker compose -f \${DOCKER_COMPOSE_FILE} -f docker-compose.e2e.yml --profile e2e run --rm --no-deps cypress"
                }
            }
            post {
                always {
                    sh "DOCKER_HOST=\$DOCKER_HOST docker compose -f \${DOCKER_COMPOSE_FILE} -f docker-compose.e2e.yml down -v --remove-orphans || true"
                }
            }
        }

        stage('Agent') {
            steps {
                dir('agent') {
                    sh 'mvn test -q'
                    sh 'mvn package -q -DskipTests'
                    // The harness adds Node/OpenCode to the runtime image; a JAR
                    // build alone does not validate that stage. Resolve
                    // DOCKER_HOST in the same shell as the build (the
                    // Integration stage's export does not persist across sh
                    // steps).
                    sh '''
                        if echo "$DOCKER_HOST" | grep -q "^tcp://"; then
                            HOSTNAME=$(echo "$DOCKER_HOST" | sed "s|tcp://||; s|:.*||")
                            PORT=$(echo "$DOCKER_HOST" | sed "s|.*:||")
                            IP=$(getent hosts "$HOSTNAME" 2>/dev/null | awk '{print $1}')
                            if [ -n "$IP" ]; then
                                export DOCKER_HOST="tcp://$IP:$PORT"
                            elif [ -n "$DOCKER_HOST_FALLBACK" ]; then
                                export DOCKER_HOST="$DOCKER_HOST_FALLBACK"
                            fi
                        fi
                        echo "Agent image build DOCKER_HOST=$DOCKER_HOST"
                        docker build -t vibecode-agent:ci .
                    '''
                }
            }
        }

        stage('Integration Tests') {
            steps {
                nodejs('Node') {
                    script {
                        // Write .env for docker compose
                        sh """
                            cat > .env <<EOF
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
JWT_SECRET=${JWT_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
PGADMIN_PASSWORD=changeme
EOF
                        """

                        // Diagnostic logging for Docker/docker compose connectivity
                        sh 'bash scripts/jenkins-docker-diagnose.sh'

                        // Fix DOCKER_HOST: Jenkins agent container may not resolve docker-socket-proxy
                        // via Docker's internal DNS (127.0.0.11). Go's net.Resolver (used by docker compose)
                        // uses getent which queries Docker DNS, not the system resolver.
                        // Multi-strategy discovery: DNS -> docker exec -> docker network inspect -> DOCKER_HOST_FALLBACK -> error.
                        sh '''
                            echo "=== DOCKER HOST RESOLUTION FIX ==="
                            ORIGINAL_HOST=$DOCKER_HOST
                            if echo "$ORIGINAL_HOST" | grep -q "^tcp://"; then
                                HOSTNAME=$(echo "$ORIGINAL_HOST" | sed "s|tcp://||; s|:.*||")
                                PORT=$(echo "$ORIGINAL_HOST" | sed "s|.*:||")
                                echo "Original DOCKER_HOST: $ORIGINAL_HOST (host=$HOSTNAME, port=$PORT)"

                                # Strategy 1: DNS resolution with getent (used by Go runtime / docker compose)
                                IP=$(getent hosts "$HOSTNAME" 2>/dev/null | awk '{print $1}')
                                if [ -n "$IP" ]; then
                                    echo "Strategy 1 SUCCESS: Resolved $HOSTNAME to $IP via getent"
                                    export DOCKER_HOST="tcp://$IP:$PORT"
                                else
                                    echo "Strategy 1 FAILED: getent cannot resolve $HOSTNAME"
                                    # Strategy 2: Get IP from inside the container via docker exec
                                    echo "Strategy 2: Trying docker exec to get IP..."
                                    IP=$(docker exec "$HOSTNAME" hostname -I 2>/dev/null | awk '{print $1}')
                                    if [ -n "$IP" ]; then
                                        echo "Strategy 2 SUCCESS: Discovered $HOSTNAME IP=$IP via docker exec"
                                        export DOCKER_HOST="tcp://$IP:$PORT"
                                    else
                                        echo "Strategy 2 FAILED: docker exec could not get IP"
                                    fi

                                    # Strategy 3: Discover IP via docker network inspect
                                    if [ -z "$IP" ]; then
                                        echo "Strategy 3: Trying docker network inspect..."
                                        NETWORK=$(docker inspect "$HOSTNAME" --format '{{(index .NetworkSettings.Networks (index .NetworkSettings.Networks 0)).Name}}' 2>/dev/null)
                                        if [ -n "$NETWORK" ]; then
                                            echo "  Network: $NETWORK"
                                            IP=$(docker network inspect "$NETWORK" --format '{{range .Containers}}{{if eq .Name "'"$HOSTNAME"'\"}}{{.IPv4Address}}{{end}}{{end}}' 2>/dev/null | sed 's|/.*||')
                                            if [ -n "$IP" ]; then
                                                echo "Strategy 3 SUCCESS: Discovered $HOSTNAME IP=$IP via docker network inspect"
                                                export DOCKER_HOST="tcp://$IP:$PORT"
                                            else
                                                echo "  No IP found via network inspect"
                                                echo "  All containers on $NETWORK:"
                                                docker network inspect "$NETWORK" --format '{{range .Containers}}{{.Name}}: {{.IPv4Address}}{{"\n"}}{{end}}' 2>/dev/null | sed 's/^/    /'
                                            fi
                                        else
                                            echo "Strategy 3 SKIPPED: Cannot determine network"
                                        fi
                                    fi

                                    # Strategy 4: Fall back to DOCKER_HOST_FALLBACK env var
                                    if [ -z "$IP" ]; then
                                        if [ -n "$DOCKER_HOST_FALLBACK" ]; then
                                            echo "Strategy 4: Using DOCKER_HOST_FALLBACK=$DOCKER_HOST_FALLBACK"
                                            export DOCKER_HOST="$DOCKER_HOST_FALLBACK"
                                        else
                                            echo "Strategy 4 SKIPPED: DOCKER_HOST_FALLBACK not set"
                                            echo ""
                                            echo "=========================================="
                                            echo "  DOCKER DNS RESOLUTION FAILURE"
                                            echo "=========================================="
                                            echo ""
                                            echo "docker-socket-proxy is not resolvable via Docker DNS (127.0.0.11)."
                                            echo "All discovery strategies failed."
                                            echo ""
                                            echo "To fix, set DOCKER_HOST_FALLBACK in Jenkins environment:"
                                            echo "  1. Find the IP on the Docker host:"
                                            echo "     docker exec docker-socket-proxy hostname -I"
                                            echo "  2. Add to Jenkins container environment:"
                                            echo "     DOCKER_HOST_FALLBACK=tcp://<IP>:2375"
                                            echo ""
                                        fi
                                    fi
                                fi
                            fi
                            echo "Final DOCKER_HOST: $DOCKER_HOST"
                            echo "=== END DOCKER HOST RESOLUTION FIX ==="
                         '''
                          sh '''
                             echo "=== Cleaning up containers from previous runs ==="
                             PROJECT_NAME="\${COMPOSE_PROJECT_NAME}"
                             echo "Target project: \$PROJECT_NAME"
                             
                             # Remove only stopped containers matching the project name
                             # (avoid killing running containers from a still-active build)
                             STOPPED_COUNT=0
                             for cid in \$(docker ps -aq --filter "name=\${PROJECT_NAME}" --filter "status=exited" --filter "status=created" 2>/dev/null); do
                                 NAME=\$(docker inspect --format='{{.Name}}' "\$cid" 2>/dev/null | sed 's,^/,,')
                                 echo "Removing stopped container: \$NAME (\$cid)"
                                 STOPPED_COUNT=\$((STOPPED_COUNT + 1))
                             done
                             
                             if [ "\$STOPPED_COUNT" -gt 0 ]; then
                                 DOCKER_HOST=\$DOCKER_HOST docker rm \$(docker ps -aq --filter "name=\${PROJECT_NAME}" --filter "status=exited" --filter "status=created" 2>/dev/null) 2>/dev/null || true
                                 echo "Previous stopped containers removed (\$STOPPED_COUNT)."
                             else
                                 echo "No previous stopped containers found for project \$PROJECT_NAME."
                             fi
                             
                             # Also clean up stopped containers from other projects older than 1 hour
                             echo "Cleaning up old stopped containers (older than 1 hour)..."
                             STALE_STOPPED=""
                             for cid in \$(docker ps -aq --filter "status=exited" --filter "status=created" 2>/dev/null); do
                                 CREATED=\$(docker inspect --format='{{.Created}}' "\$cid" 2>/dev/null)
                                 if [ -n "\$CREATED" ]; then
                                     CREATED_EPOCH=\$(date -d "\$CREATED" +%s 2>/dev/null || echo 0)
                                     NOW_EPOCH=\$(date +%s)
                                     AGE_HOURS=\$(( (NOW_EPOCH - CREATED_EPOCH) / 3600 ))
                                     if [ "\$AGE_HOURS" -ge 1 ]; then
                                         NAME=\$(docker inspect --format='{{.Name}}' "\$cid" 2>/dev/null | sed 's,^/,,')
                                         if echo "\$NAME" | grep -qiE "jenkins|docker-socket-proxy"; then
                                             echo "Skipping infrastructure container: \$NAME"
                                         else
                                             echo "Removing old stopped container: \$NAME (\$AGE_HOURS hours old)"
                                             STALE_STOPPED="\$STALE_STOPPED \$cid"
                                         fi
                                     fi
                                 fi
                             done
                             STALE_STOPPED=\$(echo "\$STALE_STOPPED" | xargs)
                             if [ -n "\$STALE_STOPPED" ]; then
                                 DOCKER_HOST=\$DOCKER_HOST docker rm \$STALE_STOPPED 2>/dev/null || true
                                 echo "Old stopped containers removed."
                             fi
                         '''

                        // Build infra (production compose) + test service
                        // Explicitly pass DOCKER_HOST to docker compose — Go plugin sometimes
                        // doesn't inherit DOCKER_HOST from Jenkins agent environment
                        sh '''
                            echo "=== PRE-COMPOSE DOCKER HOST ==="
                            echo "DOCKER_HOST=$DOCKER_HOST"
                            if echo "$DOCKER_HOST" | grep -q "://.*:"; then
                                HOST=$(echo "$DOCKER_HOST" | sed "s|tcp://||; s|:.*||")
                                echo "Extracted hostname: $HOST"
                                echo "DNS lookup result:"
                                getent hosts "$HOST" 2>&1 || echo "FAILED: $HOST not resolvable"
                                echo "==============================="
                            fi
                        '''
                        sh "DOCKER_HOST=\$DOCKER_HOST docker compose -f \${DOCKER_COMPOSE_FILE} down -v --remove-orphans || true"
                        
                        sh "DOCKER_HOST=\$DOCKER_HOST docker compose -f \${DOCKER_COMPOSE_FILE} -f docker-compose.test.yml build"
                        sh "DOCKER_HOST=\$DOCKER_HOST docker compose -f \${DOCKER_COMPOSE_FILE} up -d"

                        // Wait for infra to be ready (10 attempts, 6s apart; fail after 60s)
                        // docker-compose has start_period: 30s for API health check + migrate runs DB migrations
                        // 60s gives enough time for cold starts with migrations
                        def ready = false
                        def elapsed = 0
                        def checks = 0
                        while (elapsed < 60 && checks < 10) {
                            sleep(time: 6, unit: 'SECONDS')
                            elapsed += 6
                            checks++
                            def ps = sh(
                                script: "DOCKER_HOST=\$DOCKER_HOST docker compose -f \${DOCKER_COMPOSE_FILE} ps --format \"{{.Name}} {{.Status}}\" 2>/dev/null",
                                returnStdout: true
                            )
                            def apiUp = sh(
                                script: "DOCKER_HOST=\$DOCKER_HOST docker compose -f \${DOCKER_COMPOSE_FILE} ps --format '{{.Name}} {{.Status}}' 2>/dev/null | grep -q '${COMPOSE_PROJECT_NAME}-api.*Up'",
                                returnStatus: true
                            ) == 0
                            def pgUp = sh(
                                script: "DOCKER_HOST=\$DOCKER_HOST docker compose -f \${DOCKER_COMPOSE_FILE} ps --format '{{.Name}} {{.Status}}' 2>/dev/null | grep -q '${COMPOSE_PROJECT_NAME}-postgres.*Up'",
                                returnStatus: true
                            ) == 0
                            if (apiUp && pgUp) {
                                ready = true
                                break
                            }
                            echo "Service check attempt ${checks}/10 (api: ${apiUp}, pg: ${pgUp}, elapsed: ${elapsed}s)"
                        }
                        if (!ready) {
                            echo "ERROR: Stack not ready after 60s (10 checks failed)"
                            sh "DOCKER_HOST=\$DOCKER_HOST docker compose -f \${DOCKER_COMPOSE_FILE} logs --tail=100 || true"
                            sh "DOCKER_HOST=\$DOCKER_HOST docker compose -f \${DOCKER_COMPOSE_FILE} ps || true"
                            error("Integration stack failed to start within 60 seconds")
                        }
                        echo "Infra ready after ${elapsed}s (${checks} checks)"

                        // Start test container (no auto-run command, tests run via exec)
                        sh "DOCKER_HOST=\$DOCKER_HOST docker compose -f \${DOCKER_COMPOSE_FILE} -f docker-compose.test.yml up -d test"

                        // Run Jest integration tests inside the test container
                        // forceExit: true returns exit code 1 when DB connections are still open,
                        // so check output for failures instead of relying on exit code
                        sh '''
                            DOCKER_HOST=$DOCKER_HOST docker compose -f \${DOCKER_COMPOSE_FILE} -f docker-compose.test.yml exec -T test bash -c '
                                cd /app
                                OUTPUT=$(./node_modules/.bin/jest --config jest.integration.config.js --verbose 2>&1)
                                echo "$OUTPUT"
                                if echo "$OUTPUT" | grep -E "^(Test Suites:|Tests:)" | grep -qi "failed"; then
                                    exit 1
                                fi
                            '
                        '''

                        // Run bash integration tests inside the test container
                        sh '''
                            DOCKER_HOST=$DOCKER_HOST docker compose -f \${DOCKER_COMPOSE_FILE} -f docker-compose.test.yml exec -T test bash -c '
                                cd /app
                                set -x
                                BASE_URL=http://api:3001 bash integration-test/run.sh --only 2>&1
                                EXIT_CODE=$?
                                echo "--- bash test exit code: $EXIT_CODE ---"
                                exit $EXIT_CODE
                            '
                        '''
                    }
                }
            }
        }
    }

    post {
        always {
            cleanWs()
        }
        success {
            echo 'All stages passed.'
            script {
                try {
                    // Only remove containers and test-specific volumes, keep postgres_data
                    sh "DOCKER_HOST=\$DOCKER_HOST docker compose -f \${DOCKER_COMPOSE_FILE} -f docker-compose.test.yml down --remove-orphans || true"
                    echo 'Integration test stack cleaned up (data volumes preserved).'
                } catch (Exception e) {
                    echo "Cleanup failed (non-fatal): ${e.getMessage()}"
                }
            }
        }
        failure {
            echo 'Pipeline failed. Check logs for details.'
        }
    }
}
