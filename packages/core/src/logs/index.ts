export type RetentionDays = 1 | 3 | 5 | 7 | 14 | 30 | 60 | 90 | 120 | 150 | 180 | 365 | 400 | 545 | 731 | 1096 | 1827 | 2192 | 2557 | 2922 | 3288 | 3653

/** Gives every lambda of the stack a log group of its own, /lambada/<project>/<name>-<env>. */
export type LambadaLogs = {
    /** Without it, logs never expire. A lambda's own `logRetention` wins over it. */
    retention?: { days: RetentionDays }
}

export type LogsResult = LambadaLogs & { prefix: string }
