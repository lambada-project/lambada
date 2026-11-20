# Lambada example

A to-do app that uses most of what [Lambada](https://lambada-project.github.io) declares, in one `run()` call.

| | Declared in `src/index.ts` | Code |
| --- | --- | --- |
| HTTP API | `GET /todos`, `POST /todos`, `POST /todos/{id}/remind`, `GET /health` | `src/api/todos.ts` |
| Table | `todos`, holding each user's todos and their total | `src/lib/aws/todo-repository.ts` |
| Topic | `todoCreated`, published by `POST /todos` | `src/lib/aws/messaging.ts` |
| Subscriber | `onTodoCreated` counts each new todo | `src/events/handlers.ts` |
| Queue | `reminders`, sent to by `POST /todos/{id}/remind` | `src/lib/aws/messaging.ts` |
| Queue handler | `sendReminder`, with partial batch failures | `src/events/handlers.ts` |
| Schedule | `recomputeTotals`, nightly at 03:00 UTC | `src/events/handlers.ts` |
| Static site + CDN | the React app in `src/www`, behind CloudFront with the API | `src/www` |

Every function is granted only what it uses: compare the `resources` of `getTodos` and `postTodo`.

The application logic in `src/lib/todos` knows nothing about AWS. Handlers build it with the AWS adapters in `src/lib/aws`, and its tests use in-memory fakes.

## Run the tests

Open this folder in its devcontainer, which has AWS Emulator, Bun and the Pulumi CLI, then:

```bash
npm install
npm test             # starts AWS Emulator, runs the tests, stops it
npm run typecheck
```

## Deploy

```bash
pulumi stack init dev
npm run deploy       # builds src/www, then pulumi up
open "$(pulumi stack output siteUrl)"
```

To work on the app against the deployed API:

```bash
cd src/www && npm install
API_URL=$(pulumi stack output apiUrl --cwd ../..) npm run dev
```

`pulumi destroy` removes everything.
