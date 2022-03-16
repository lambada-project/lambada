import { FunctionConfiguration, LambdaClient, ListFunctionsCommand } from '@aws-sdk/client-lambda'
import { GetResourcesCommand, GetResourcesInput, ResourceGroupsTaggingAPIClient, ResourceTagMapping } from '@aws-sdk/client-resource-groups-tagging-api'

const lambdaClient = new LambdaClient({ region: "eu-west-1" });
const resourcesClient = new ResourceGroupsTaggingAPIClient({ region: "eu-west-1" });




const main = async () => {
    const lambdas = await getAllLambdas()
    const tags = await getAllTags("Environment", "dev")
    const handlers = await getMessageHandlers(tags, lambdas)
    console.log(handlers)
}

main()

async function getMessageHandlers(tags: ResourceTagMapping[], lambdas: FunctionConfiguration[]) {
    return tags
        .map(x => {
            return {
                resource: lambdas.find(y => y.FunctionArn?.toLowerCase() === x.ResourceARN?.toLowerCase()),
                tags: x.Tags
            }
        })
        .filter(x => x.resource)
}


async function* getTagPage(key: string, value: string) {
    let marker: string | undefined
    do {
        const listCommand = new GetResourcesCommand({
            PaginationToken: marker,
            TagFilters: [
                {
                    Key: key,
                    Values: [value]
                }
            ]
        })
        const result = await resourcesClient.send(listCommand)
        yield result.ResourceTagMappingList ?? []
        marker = result.PaginationToken
    } while (marker)
}

async function getAllTags(key: string, value: string) {
    const tags: ResourceTagMapping[] = []

    for await (const page of getTagPage(key, value)) {
        tags.push(...page)
    }

    console.log('Found tags:', tags.length)
    return tags
}


async function* getLambdaPage() {
    let marker: string | undefined
    do {
        const listCommand = new ListFunctionsCommand({
            Marker: marker
        })
        const result = await lambdaClient.send(listCommand)
        yield result.Functions ?? []
        marker = result.NextMarker
    } while (marker)
}

async function getAllLambdas() {
    const lambdas: FunctionConfiguration[] = []

    for await (const page of getLambdaPage()) {
        lambdas.push(...page)
    }

    console.log('Found lambdas:', lambdas.length)
    return lambdas
}

