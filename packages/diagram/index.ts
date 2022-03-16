import { FunctionConfiguration, LambdaClient, ListFunctionsCommand } from '@aws-sdk/client-lambda'
import { SNSClient, ListTopicsCommand, Topic, ListSubscriptionsCommand, Subscription } from '@aws-sdk/client-sns'
import { GetResourcesCommand, ResourceGroupsTaggingAPIClient, ResourceTagMapping } from '@aws-sdk/client-resource-groups-tagging-api'

const region = 'eu-west-1'
const lambdaClient = new LambdaClient({ region: region });
const resourcesClient = new ResourceGroupsTaggingAPIClient({ region: region });
const snsClient = new SNSClient({ region: region });



const main = async () => {
    const lambdas = await getAllLambdas()
    const topics = await getAllSNSTopics()
    const subscriptions = await getSubscriptions()
    const tags = await getAllTags("Environment", "dev")


    const events = await getEvents(tags, lambdas, topics, subscriptions)

    generateDiagramData(events)
}

main()

type Event = { subscription: Subscription, handler: FunctionConfiguration, sender: string }
function generateDiagramData(events: Event[]) {
    let data = ''
    for (const e of events) {
        data+= `${e.sender}->${e.handler.FunctionName} ${e.subscription.TopicArn}\n`;
    }
    console.log(data)
}

function getEvents(tags: ResourceTagMapping[], lambdas: FunctionConfiguration[], topics: Topic[], subscriptions: Subscription[]): Event[] {
    return subscriptions
        .map(subscription => ({
            subscription: subscription.TopicArn?.includes('lockReverted-dev') ? subscription : undefined,
            handler: lambdas.find(lambda => lambda.FunctionArn == subscription.Endpoint),
            sender: 'SOMEONE'
        }))
        .filter((x): x is Event => x.subscription !== undefined && x.handler !== undefined)
}





async function* getSubscriptionsPage() {
    let marker: string | undefined
    do {
        const listCommand = new ListSubscriptionsCommand({
            NextToken: marker
        })
        const result = await snsClient.send(listCommand)
        yield result.Subscriptions ?? []
        marker = result.NextToken
    } while (marker)
}

async function getSubscriptions() {
    const subscriptions: Subscription[] = []

    for await (const page of getSubscriptionsPage()) {
        subscriptions.push(...page)
    }

    console.log('Found subscriptions:', subscriptions.length)
    return subscriptions
}






async function* getTopicPage() {
    let marker: string | undefined
    do {
        const listCommand = new ListTopicsCommand({
            NextToken: marker,
        })
        const result = await snsClient.send(listCommand)
        yield result.Topics ?? []
        marker = result.NextToken
    } while (marker)
}

async function getAllSNSTopics() {
    const topics: Topic[] = []

    for await (const page of getTopicPage()) {
        topics.push(...page)
    }

    console.log('Found topics:', topics.length)
    return topics
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

