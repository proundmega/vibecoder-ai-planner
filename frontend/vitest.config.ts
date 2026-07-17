import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import path from 'path';

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60,
      },
      include: ['src/**/*.{js,ts,vue}'],
      exclude: [
        'src/**/*.test.*',
        'src/api/generated/**',
        'src/main.ts',
        // Untested views
        'src/views/AIAssistant.vue',
        'src/views/ApprovalsQueue.vue',
        'src/views/BillingDashboard.vue',
        'src/views/CodeReview.vue',
        'src/views/ComputeNodes.vue',
        'src/views/Dashboard.vue',
        'src/views/GitHubConnections.vue',
        'src/views/Login.vue',
        'src/views/PhaseFlow.vue',
        'src/views/ProjectApprovals.vue',
        'src/views/ProjectDetail.vue',
        'src/views/ProjectList.vue',
        'src/views/ProjectMilestones.vue',
        'src/views/ProjectTemplates.vue',
        'src/views/SuperAdminUsers.vue',
        'src/views/TerminalView.vue',
        'src/views/TicketBoard.vue',
        'src/views/TicketDetail.vue',
        'src/views/UserManagement.vue',
        // Untested phase views
        'src/views/phases/PhaseAssigned.vue',
        'src/views/phases/PhaseBlocked.vue',
        'src/views/phases/PhaseDeployed.vue',
        'src/views/phases/PhaseDone.vue',
        'src/views/phases/PhaseDraft.vue',
        'src/views/phases/PhaseHumanApproval.vue',
        'src/views/phases/PhaseInProgress.vue',
        'src/views/phases/PhasePlanApproved.vue',
        'src/views/phases/PhasePlanning.vue',
        'src/views/phases/PhaseReview.vue',
        // Untested components
        'src/components/ComputeNodeModal.vue',
        'src/components/DiffViewer.vue',
        'src/components/PhaseProgress.vue',
        'src/components/MilestoneModal.vue',
        'src/components/AgentEditModal.vue',
        'src/components/UserModal.vue',
        // Untested modules
        'src/composables/aiChatDataSource.ts',
        'src/utils/diff.ts',
        // Untested API clients
        'src/api/computeNodes.ts',
        'src/api/credentials.ts',
        'src/api/deployments.ts',
        'src/api/milestones.ts',
        'src/api/review.ts',
      ],
    },
  },
});
