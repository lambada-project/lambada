---
title: Quickstart
sidebar_label: Quickstart
slug: /quickstart
---


## Requirements
- You'll need npm installed locally if you want to bootstrap with the npm initializer
- A pulumi account (free), or knowledge on how to store the deployment state somewhere else. To know more about this refer to their docs: https://www.pulumi.com/docs/intro/concepts/state/
- A AWS account, and credentials configured locally. If you are using several AWS profiles, please read [this page](/aws-config) 

## Installation

1. ** Scaffolding with the npm initializer ** 
    
    Create a directory for your project, change to it, and run the initializer:
    
    **⚠ WARNING ⚠** At the moment, the initializer does not warn if executing on not empty directories, so be careful where you call it from.
    ```bash
    mkdir <your-project-name> && cd <your-project-name>
    npm init @lambada
    ```


2. **VSCode DevContainers**

    - Install [Docker](https://docs.docker.com/get-docker) and [VSCode](https://code.visualstudio.com/) if you don't have them already 
    - Install the following VSCode extension: `ms-vscode-remote.vscode-remote-extensionpack`
    - Open the project root with `code .` and once it's loaded, the extension will prompt you to  `Reopen in Container`, click it button and be the happiest developer ever 😀


NOTE: If not using DevContainers open the `Dockerfile` and install in your local machine all the dependencies listed there.

## Build and Deploy
First, open the `src/index.ts` file and as you can see, the default template comes with a simple one-liner health-check. 

```typescript
const result = run(projectName, environment,
{
    endpointDefinitions: [
        (context) => ({
            path: '/test',
            method: 'GET',
            callbackDefinition: async (event) => ({ ok: true })
        })
    ]
})

export const apiUrl = result.api.url

```

Every endpoint is a function that returns an object that describes your infrastructure. In this case we return an endpoint that describes our test api (listen on GET /test) and it has a callback that returns a simple object `{ ok: true }`  that will be serialized to json with a `200` status code.

Now, we want our new api up and running, and to do so we call the pulumi cli (comes installed in the dockerfile).

```bash
pulumi up
```

**Note:** Ensure your AWS credentials are correctly configured before running the above command. You can verify this by running `aws configure` or checking your environment variables.

This will ask to create several resources in AWS:
- 1 APIGateway
- 1 Lambda
- Execution, access, etc

Evaluate the resources to be created and press `Y` once you confirmed all is good.
In a few seconds you'll have your api in AWS and you can call it with your favourite client. The url of the ApiGateway will be shown as an output of the last operation, in our case we called it `apiUrl`.

If you want to know more about Pulumi, check out their amazing documentation: https://www.pulumi.com/docs/intro/


### Final steps
Congratulations!!, you have saved hours by using this tool and not doing the `ClickyClicky` (Trademark pending)
