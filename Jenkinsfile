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
        DATABASE_URL = "postgresql://postgres:${POSTGRES_PASSWORD}@localhost:5432/vibecode"
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
                        sh 'npm test -- --run src/__tests__/api-contract.test.ts'
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

                        // Build and start services
                        // sh 'docker compose down --remove-orphans || true'  // commented for debugging
                        sh 'docker compose build'
                        sh 'docker compose up -d'

                        // Log logs for any unhealthy containers immediately
                        def unhealthy = sh(
                            script: 'docker compose ps --filter "health=unhealthy" --format "{{.Name}}" || true',
                            returnStdout: true
                        ).trim()
                        if (unhealthy) {
                            echo "ERROR: The following containers are unhealthy:"
                            for (def container : unhealthy.split('\\n')) {
                                if (container.trim()) {
                                    echo "--- Logs for ${container.trim()} ---"
                                    sh "docker compose logs --tail=100 ${container.trim()} || true"
                                    echo "--- End logs for ${container.trim()} ---"
                                }
                            }
                        }

                        // Wait for health (3 checks, 3s apart; fail after 30s)
                        def healthy = false
                        def elapsed = 0
                        def checks = 0
                        while (elapsed < 30 && checks < 3) {
                            sleep(time: 3, unit: 'SECONDS')
                            elapsed += 3
                            checks++
                            def status = sh(
                                script: 'curl -sf http://localhost:3001/api/health || true',
                                returnStatus: true
                            )
                            if (status == 0) {
                                healthy = true
                                break
                            }
                            echo "Health check attempt ${checks}/3 failed (elapsed: ${elapsed}s)"
                        }
                        if (!healthy) {
                            echo "ERROR: Stack not healthy after 30s (3 checks failed)"
                            sh 'docker compose logs --tail=50 || true'
                            sh 'docker compose ps || true'
                            error("Integration stack failed to start within 30 seconds")
                        }
                        echo "Stack healthy after ${elapsed}s (${checks} checks)"

                        // Jest integration tests
                        sh """
                            INTEGRATION_TESTS=1 DATABASE_URL="${DATABASE_URL}" \
                            npx jest --config backend/jest.integration.config.js --verbose
                        """

                        // Bash integration tests
                        sh 'bash backend/integration-test/run.sh --only'
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
