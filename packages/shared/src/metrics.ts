export type MetricUnit = "Count" | "Milliseconds" | "Bytes" | "None";

/** Emit CloudWatch Embedded Metric Format with fixed, non-personal dimensions only. */
export function emitMetric(
  metricName: string,
  value: number,
  unit: MetricUnit,
  operation: string,
  service = process.env.AWS_LAMBDA_FUNCTION_NAME ?? "local",
): void {
  if (
    !/^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(metricName) ||
    !/^[A-Za-z0-9/:_{}.-]{1,120}$/u.test(operation)
  ) {
    throw new Error("UnsafeMetricMetadata");
  }
  const environment = process.env.APP_ENV ?? "local";
  process.stdout.write(
    `${JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: "GiftsInService",
            Dimensions: [["Environment", "Service", "Operation"]],
            Metrics: [{ Name: metricName, Unit: unit }],
          },
        ],
      },
      Environment: environment,
      Service: service,
      Operation: operation,
      [metricName]: value,
    })}\n`,
  );
}
