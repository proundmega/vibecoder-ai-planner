/**
 * @openapi
 * /metrics:
 *   get:
 *     tags: [System]
 *     summary: Prometheus metrics endpoint
 *     parameters:
 *       - in: header
 *         name: x-metrics-token
 *         required: false
 *         description: Required if METRICS_TOKEN env var is set
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Prometheus-format metrics (text/plain)
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *       401:
 *         description: Unauthorized when METRICS_TOKEN is set and token is missing or incorrect
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: object
 *                   properties:
 *                     code:
 *                       type: string
 *                       example: UNAUTHORIZED
 *                     message:
 *                       type: string
 *                       example: Metrics endpoint requires authentication
 */
module.exports = {};
