import { LambadaResources } from '..'

export * from './createApi'
export * from './createEndpoint'
export * from './createStatic'
export * from './createProxyIntegration'

import { LambadaEndpointArgs, EmbroideryEventHandlerRoute } from './createEndpoint'
import { ProxyIntegrationArgs } from './createProxyIntegration'

export type EmbroideryApiEndpointCreator = (apiContext: LambadaResources) => EmbroideryEventHandlerRoute
export type LambadaEndpointCreator = (resources: LambadaResources) => LambadaEndpointArgs
export type LambadaProxyCreator = (resources: LambadaResources) => ProxyIntegrationArgs
