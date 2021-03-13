import { LambadaResources } from '..'

export * from './createApi'
export * from './createEndpoint'
export * from './createStatic'
export * from './createProxyIntegration'

import { LambadaEndpointArgs, EmbroideryEventHandlerRoute } from './createEndpoint'

export type EmbroideryApiEndpointCreator = (apiContext: LambadaResources) => EmbroideryEventHandlerRoute
export type LambadaEndpointCreator = (resources: LambadaResources) => LambadaEndpointArgs