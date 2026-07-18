pipeline {
    agent any

    options {
        timestamps()
        timeout(time: 60, unit: 'MINUTES')
        disableConcurrentBuilds()
    }

    environment {
        POSTGRES_PASSWORD = 'changeme'
        JWT_SECRET = 'jenkins-ci-secret-for-testing-purposes-2026'
        ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
        // DATABASE_URL removed — docker-compose.yml sets it to postgres:5432 for the API container.
        // Integration tests set their own DATABASE_URL pointing to localhost:5432 (published port).
    }

    stages {
        stage('Detect Changes') {
            when {
                not { branch 'master' }
            }
            steps {
                script {
                    def diff = sh(
                        script: 'git diff --name-only origin/master...HEAD 2>/dev/null || git diff --name-only HEAD~1',
                        returnStdout: true
                    ).trim()
                    echo "Changed files:\n${diff}"

                    env.BACKEND_CHANGED = (diff =~ '(^|/)backend/' || diff =~ 'Jenkinsfile' || diff =~ 'docker-compose') ? 'true' : 'false'
                    env.FRONTEND_CHANGED = (diff =~ '(^|/)frontend/' || diff =~ 'Jenkinsfile') ? 'true' : 'false'
                    env.AGENT_CHANGED = (diff =~ '(^|/)agent/') ? 'true' : 'false'
                    env.MIGRATIONS_CHANGED = (diff =~ '(^|/)migrations/') ? 'true' : 'false'

                    echo "Backend: ${env.BACKEND_CHANGED}, Frontend: ${env.FRONTEND_CHANGED}, Agent: ${env.AGENT_CHANGED}, Migrations: ${env.MIGRATIONS_CHANGED}"
                }
            }
        }

        stage('Setup') {
            when {
                anyOf {
                    branch 'master'
                    expression { env.BACKEND_CHANGED == 'true' }
                    expression { env.FRONTEND_CHANGED == 'true' }
                    expression { env.MIGRATIONS_CHANGED == 'true' }
                    expression { env.AGENT_CHANGED == 'true' }
                }
            }
            steps {
                script {
                    if (env.BACKEND_CHANGED == 'true' || env.BRANCH_NAME == 'master') {
                        nodejs('Node') {
                            dir('backend') {
                                sh 'npm ci'
                            }
                        }
                    }
                    if (env.FRONTEND_CHANGED == 'true' || env.BRANCH_NAME == 'master') {
                        nodejs('Node') {
                            dir('frontend') {
                                sh 'npm ci'
                            }
                        }
                    }
                }
            }
        }

        stage('Backend') {
            when {
                anyOf {
                    branch 'master'
                    expression { env.BACKEND_CHANGED == 'true' }
                    expression { env.MIGRATIONS_CHANGED == 'true' }
                }
            }
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
            when {
                anyOf {
                    branch 'master'
                    expression { env.FRONTEND_CHANGED == 'true' }
                }
            }
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
            when {
                anyOf {
                    branch 'master'
                    expression { env.BACKEND_CHANGED == 'true' }
                    expression { env.FRONTEND_CHANGED == 'true' }
                }
            }
            steps {
                nodejs('Node') {
                    dir('frontend') {
                        sh 'npm ci'
                        sh './node_modules/.bin/vitest --run src/__tests__/api-contract.test.ts'
                    }
                }
            }
        }

        stage('Agent') {
            when {
                anyOf {
                    branch 'master'
                    expression { env.AGENT_CHANGED == 'true' }
                }
            }
            steps {
                tool(name: 'Maven', type: 'maven') {
                    dir('agent') {
                        sh 'mvn package -q -DskipTests'
                    }
                }
            }
        }

        stage('Integration Tests') {
            when {
                anyOf {
                    branch 'master'
                    expression { env.BACKEND_CHANGED == 'true' }
                    expression { env.FRONTEND_CHANGED == 'true' }
                    expression { env.MIGRATIONS_CHANGED == 'true' }
                    expression { env.AGENT_CHANGED == 'true' }
                }
            }
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

                        // Build infra (production compose) + test service
                        sh 'docker compose -f docker-compose.yml down --remove-orphans || true'
                        sh 'docker compose -f docker-compose.yml -f docker-compose.test.yml build'
                        sh 'docker compose -f docker-compose.yml up -d'

                        // Wait for infra to be ready (3 attempts, 3s apart; fail after 30s)
                        def ready = false
                        def elapsed = 0
                        def checks = 0
                        while (elapsed < 30 && checks < 3) {
                            sleep(time: 3, unit: 'SECONDS')
                            elapsed += 3
                            checks++
                            def ps = sh(
                                script: 'docker compose -f docker-compose.yml ps --format "{{.Name}} {{.Status}}" 2>/dev/null',
                                returnStdout: true
                            )
                            def apiUp = ps =~ /vibecode-api.*Up/
                            def pgUp = ps =~ /vibecode-postgres.*Up/
                            if (apiUp && pgUp) {
                                ready = true
                                break
                            }
                            echo "Service check attempt ${checks}/3 (api: ${apiUp}, pg: ${pgUp}, elapsed: ${elapsed}s)"
                        }
                        if (!ready) {
                            echo "ERROR: Stack not ready after 30s (3 checks failed)"
                            sh 'docker compose -f docker-compose.yml logs --tail=100 || true'
                            sh 'docker compose -f docker-compose.yml ps || true'
                            error("Integration stack failed to start within 30 seconds")
                        }
                        echo "Infra ready after ${elapsed}s (${checks} checks)"

                        // Start test container (no auto-run command, tests run via exec)
                        sh 'docker compose -f docker-compose.yml -f docker-compose.test.yml up -d test'

                        // Run Jest integration tests inside the test container
                        // forceExit: true returns exit code 1 when DB connections are still open,
                        // so check output for failures instead of relying on exit code
                        sh '''
                            docker exec -w /app vibecode-test bash -c '
                                OUTPUT=$(./node_modules/.bin/jest --config jest.integration.config.js --verbose 2>&1)
                                echo "$OUTPUT"
                                if echo "$OUTPUT" | grep -E "^(Test Suites:|Tests:)" | grep -qi "failed"; then
                                    exit 1
                                fi
                            '
                        '''

                        // Run bash integration tests inside the test container
                        sh '''
                            docker exec -w /app vibecode-test bash -c '
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
        }
        failure {
            echo 'Pipeline failed. Check logs for details.'
        }
    }
}
