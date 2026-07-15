pipeline {
    agent any

    options {
        timestamps()
        timeout(time: 60, unit: 'MINUTES')
        disableConcurrentBuilds()
    }

    environment {
        POSTGRES_PASSWORD = 'changeme'
        JWT_SECRET = 'jenkins-ci-secret'
        ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
        DATABASE_URL = "postgresql://postgres:${POSTGRES_PASSWORD}@localhost:5432/vibecode"
        INTEGRATION_TESTS = '1'
    }

    stages {
        stage('Detect Changes') {
            when {
                not { branch 'main' }
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
                                sh 'npm ci'
                                sh 'npm run lint'
                            }
                        }
                    }
                }
                stage('Backend Syntax') {
                    steps {
                        nodejs('Node') {
                            dir('backend') {
                                sh 'npm ci'
                                sh 'node --check src/index.js'
                            }
                        }
                    }
                }
                stage('Backend Unit Tests') {
                    steps {
                        nodejs('Node') {
                            dir('backend') {
                                sh 'npm ci'
                                sh 'npm test'
                            }
                        }
                    }
                    post {
                        always {
                            junit allowEmptyResults: true, testResults: 'backend/test-results/**/*.xml'
                        }
                    }
                }
                stage('Backend Coverage') {
                    steps {
                        nodejs('Node') {
                            dir('backend') {
                                sh 'npm ci'
                                sh 'npm run test:coverage'
                            }
                        }
                    }
                    post {
                        always {
                            junit allowEmptyResults: true, testResults: 'backend/coverage/junit.xml'
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
                                sh 'npm ci'
                                sh 'npm run lint'
                            }
                        }
                    }
                }
                stage('Frontend Typecheck') {
                    steps {
                        nodejs('Node') {
                            dir('frontend') {
                                sh 'npm ci'
                                sh 'npm run typecheck'
                            }
                        }
                    }
                }
                stage('Frontend Unit Tests') {
                    steps {
                        nodejs('Node') {
                            dir('frontend') {
                                sh 'npm ci'
                                sh 'npm test -- --run'
                            }
                        }
                    }
                    post {
                        always {
                            junit allowEmptyResults: true, testResults: 'frontend/test-results/**/*.xml'
                        }
                    }
                }
                stage('Frontend Coverage') {
                    steps {
                        nodejs('Node') {
                            dir('frontend') {
                                sh 'npm ci'
                                sh 'npm test -- --run --coverage'
                            }
                        }
                    }
                }
                stage('Frontend Build') {
                    steps {
                        nodejs('Node') {
                            dir('frontend') {
                                sh 'npm ci'
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
                        sh 'docker compose down --remove-orphans || true'
                        sh 'docker compose build api'
                        sh 'docker compose up -d postgres redis api frontend migrate'

                        // Wait for health
                        waitUntil(timeout: 120, interval: 5) {
                            def status = sh(
                                script: 'curl -sf http://localhost:3001/api/health || true',
                                returnStatus: true
                            )
                            return status == 0
                        }

                        // Jest integration tests
                        sh """
                            DATABASE_URL="${DATABASE_URL}" \
                            npx jest --config backend/jest.integration.config.js --verbose
                        """

                        // Bash integration tests
                        sh 'bash backend/integration-test/run.sh --only'
                    }
                }
            }
            post {
                always {
                    sh 'docker compose down -v || true'
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
