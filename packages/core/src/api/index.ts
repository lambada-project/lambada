import { EmbroideryContext, EmbroideryEventHandlerRoute } from '..'

export * from './createApi'
export * from './createCorsEndpoints'
export * from './createEndpoint'
export * from './createStatic'
export * from './utils'
export * from './createProxyIntegration'

export type EmbroideryApiEndpointCreator = (apiContext: EmbroideryContext) => EmbroideryEventHandlerRoute
