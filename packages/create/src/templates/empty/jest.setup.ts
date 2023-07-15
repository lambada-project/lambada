import { ConfigureAwsEnvironment } from '@lambada/core'
import { localAWS } from './lambada.config'

beforeAll(async () => {
    ConfigureAwsEnvironment({
        options: localAWS
    })
})