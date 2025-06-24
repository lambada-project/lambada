import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";

export const createCloudFront = (
    projectName: string,
    environment: string,
    api?: {
        domain: pulumi.Input<string>,
        path: pulumi.Input<string>,
        pattern: string
    },
    www?: {
        domain: pulumi.Input<string>,
        path: pulumi.Input<string>,

        spa?: {
            /**
             * If set, 404 errors will be redirected to /
             */
            notFoundRedirection: boolean
            entrypoint?: string
        }
    },
    customDomain?: {
        domainWithCert: string
        aliases: string[]
    }
) => {

    const wwwOriginId = 'wwwOriginId'
    const apiOriginId = 'apiOriginId'

    const origins: aws.types.input.cloudfront.DistributionOrigin[] = []
    const behaviours: aws.types.input.cloudfront.DistributionOrderedCacheBehavior[] = []


    if (api) {
        origins.push({
            originId: apiOriginId,
            domainName: api.domain,
            originPath: api.path,
            customOriginConfig: {
                originProtocolPolicy: "https-only",
                originSslProtocols: ['TLSv1.2'],
                httpPort: 80,
                httpsPort: 443,
            },
        })

        behaviours.push(
            {
                pathPattern: `${api.pattern}/*`,
                allowedMethods: [
                    "DELETE",
                    "GET",
                    "HEAD",
                    "OPTIONS",
                    "PATCH",
                    "POST",
                    "PUT",
                ],
                cachedMethods: [
                    "GET",
                    "HEAD",
                    "OPTIONS",
                ],
                targetOriginId: apiOriginId,
                forwardedValues: {
                    queryString: true,
                    //headers: ["*"],
                    headers: [
                        'Access-Control-Request-Headers',
                        'Access-Control-Request-Method',
                        'Origin',
                        'Authorization',
                        "Cache-Control",
                        'Set-Cookie'
                    ],
                    cookies: {
                        forward: "all",
                    },
                },
                minTtl: 0,
                defaultTtl: 60,
                maxTtl: 120,
                compress: true,
                viewerProtocolPolicy: "https-only",
            }
        )
    }

    if (www) {
        // TODO: Detect if S3, then http instead of https
        // OR allow these options to be passed in
        origins.push({
            originId: wwwOriginId,
            domainName: www.domain,
            originPath: www.path,
            customOriginConfig: {
                originProtocolPolicy: "https-only",
                originSslProtocols: ['TLSv1.2'],
                httpPort: 80,
                httpsPort: 443,
            },

        })

        // TODO: add flag
        const functionName = `${projectName}-cloudfront-www-index-${environment}`
        const wwwFunction = new aws.cloudfront.Function(functionName, {
            code: `
function handler(event) {
    var uri = event.request.uri;
    var extensions = [
        '.js', '.css', '.svg', '.jpg', '.jpeg', '.gif',
        '.ico', '.webp', '.json', '.png', '.woff', '.woff2',
        '.ttf', '.otf', '.eot', '.mp4', '.webm', '.ogg',
        '.mp3', '.wav', '.wasm', '.map'
    ];

    for (var i = 0; i < extensions.length; i++) {
        if (uri.endsWith(extensions[i])) {
            return event.request;
        }
    }

    event.request.uri = '/index.html';
    return event.request;
}

                `,
            runtime: 'cloudfront-js-1.0',
            publish: true,
            name: functionName
        })

        behaviours.push(
            {
                pathPattern: `*`,
                allowedMethods: [
                    "GET",
                    "HEAD",
                    "OPTIONS",
                ],
                cachedMethods: [
                    "GET",
                    "HEAD",
                    "OPTIONS",
                ],
                targetOriginId: wwwOriginId,
                forwardedValues: {
                    queryString: true,
                    //headers: ["*"],
                    headers: [
                        'Access-Control-Request-Headers',
                        'Access-Control-Request-Method',
                        'Origin',
                        'Authorization',
                        "Cache-Control",
                        'Set-Cookie'
                    ],
                    cookies: {
                        forward: "all",
                    },
                },
                minTtl: 0,
                defaultTtl: 60,
                maxTtl: 120,
                compress: true,
                viewerProtocolPolicy: "https-only",
                functionAssociations: [{
                    eventType: 'viewer-request',
                    functionArn: wwwFunction.arn
                }]
            }
        )
    }

    // Note: CF certificates MUST be on us-east-1
    const useast1 = customDomain ? new aws.Provider("useast1", {
        profile: aws.config.profile,
        region: "us-east-1",
    }) : null;

    const cert = customDomain && useast1 ?
        pulumi.output(aws.acm.getCertificate({
            domain: customDomain.domainWithCert,
        }, {
            provider: useast1
        })) : undefined

    // TODO: Set price tier

    return new aws.cloudfront.Distribution(`${projectName}-${environment}`, {
        enabled: true,
        origins: origins,
        aliases: customDomain?.aliases ?? undefined,

        // customErrorResponses: www?.spa?.notFoundRedirection ? [
        //     {
        //         errorCode: 400,
        //         responseCode: 200,
        //         responsePagePath: www.spa?.entrypoint ?? '/index.html'
        //     }
        // ] : [],

        orderedCacheBehaviors: behaviours,
        defaultCacheBehavior: {
            // TODO: MAYBE THIS SHOULD BE GET ONLY?
            allowedMethods: [
                "DELETE",
                "GET",
                "HEAD",
                "OPTIONS",
                "PATCH",
                "POST",
                "PUT",
            ],
            cachedMethods: [
                "GET", "HEAD"
            ],
            viewerProtocolPolicy: "allow-all",
            forwardedValues: {
                queryString: true,
                cookies: {
                    forward: "all",
                },
            },
            targetOriginId: www ? wwwOriginId : apiOriginId,
            minTtl: 0,
            defaultTtl: 0,
            maxTtl: 3600,
        },
        restrictions: {
            geoRestriction: {
                restrictionType: 'none'
            }
        },
        viewerCertificate: {
            cloudfrontDefaultCertificate: customDomain ? false : true,
            acmCertificateArn: cert?.arn,
            minimumProtocolVersion: customDomain ? 'TLSv1' : undefined,
            sslSupportMethod: customDomain ? 'sni-only' : undefined
        },
    })
}