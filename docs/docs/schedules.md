---
title: Schedules
sidebar_label: Schedules
slug: /schedules
description: Run a function on a rate or a cron, written as typed objects instead of expression strings.
---

A schedule runs a function on a timer through an EventBridge rule. It is declared under `scheduleDefinitions`, and its timing is a typed object rather than an expression string, so a schedule EventBridge would reject doesn't compile.

```ts
run('shop', environment, {
    tables: { carts: { name: 'carts', primaryKey: 'id', envKeyName: 'CARTS_TABLE' } },
    buckets: { reports: { name: 'shop-reports', envKeyName: 'REPORTS_BUCKET' } },
    scheduleDefinitions: [
        {
            name: 'expireCarts',
            schedule: { every: { minutes: 15 } },
            callback: expireCarts,
            resources: { table: { carts: ['dynamodb:Query', 'dynamodb:DeleteItem'] } },
        },
        {
            name: 'weekdayReport',
            schedule: { cron: { minute: 0, hour: 7, dayOfWeek: { from: 'MON', to: 'FRI' } } },
            callback: weekdayReport,
            resources: { bucket: { reports: ['s3:PutObject'] } },
        },
    ],
})
```

## Declaring a schedule

| Field | Required | Description |
| --- | --- | --- |
| `name` | yes | Names the function, its role and the rule. |
| `schedule` | yes | `{ every }` or `{ cron }`: see below. |
| `callback` | yes | `async (event, context) => void`, or a [bundle folder](bundles). |
| `resources` | yes | What the function is [granted](permissions). `{}` for nothing. |
| `onFailure`, `retries`, `maximumEventAge` | | What happens when it fails, as for a [subscription](topics#failures). |
| `lambdaOptions`, `environmentVariables`, `policyStatements` | | See [Function options](functions) and [Permissions](permissions). |

The callback receives EventBridge's scheduled event (`ScheduleCallback`). Schedules run in **UTC**.

## Rates

`every` takes exactly one of `minutes`, `hours` or `days`, as a whole number:

| Schedule | Expression |
| --- | --- |
| `{ every: { minutes: 10 } }` | `rate(10 minutes)` |
| `{ every: { hours: 1 } }` | `rate(1 hour)` |
| `{ every: { days: 7 } }` | `rate(7 days)` |

## Crons

`cron` takes one or more of `minute`, `hour`, `dayOfMonth`, `month`, `dayOfWeek` and `year`. A field left out means every value. A cron sets `dayOfMonth` or `dayOfWeek`, never both, as EventBridge requires.

Each field takes a value, a list, a range or a step:

| Form | Example | Expression |
| --- | --- | --- |
| value | `hour: 12` | `12` |
| list | `month: ['JAN', 'JUL']` | `JAN,JUL` |
| range | `dayOfWeek: { from: 'MON', to: 'FRI' }` | `MON-FRI` |
| range with step | `minute: { from: 5, to: 10, every: 2 }` | `5-10/2` |
| step | `minute: { every: 15, from: 5 }` | `5/15` |

And the day fields add EventBridge's special forms:

| Example | Expression | Meaning |
| --- | --- | --- |
| `dayOfMonth: 'last'` | `L` | the last day of the month |
| `dayOfMonth: { nearestWeekdayTo: 15 }` | `15W` | the weekday nearest the 15th |
| `dayOfWeek: { last: 'FRI' }` | `FRIL` | the last Friday of the month |
| `dayOfWeek: { nth: 3, of: 'FRI' }` | `FRI#3` | the third Friday of the month |

Some complete schedules:

```ts
{ cron: { minute: 0, hour: 12 } }                                   // cron(0 12 * * ? *): noon every day
{ cron: { minute: 30, hour: 2, dayOfMonth: 1 } }                    // 02:30 on the 1st
{ cron: { minute: 0, hour: { from: 22, to: 2 } } }                  // on the hour, 22:00 through 02:00
{ cron: { minute: 0, hour: 9, dayOfWeek: { nth: 1, of: 'MON' } } }  // 09:00 on the first Monday
```

Hours, minutes, days and months may wrap around, as `hour: { from: 22, to: 2 }` does. Years may not.

The types follow what EventBridge accepts: they were built by submitting expressions to EventBridge and recording which it took. The few forms EventBridge accepts but doesn't document (fractional minutes, `*/0`, numeric months) are refused. A rate that isn't a whole number from 1 upwards is refused when the stack is built, naming the schedule.

`scheduleExpression(name, schedule)` returns the expression lambada writes, if you need it elsewhere.
