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
        path: pulumi.Input<string>
    },
    customDomain?: string[]
) => {

    const wwwOriginId = 'wwwOriginId'
    const apiOriginId = 'apiOriginId'

    const origins: aws.types.input.cloudfront.DistributionOrigin[] = []
    const behaviours: aws.types.input.cloudfront.DistributionOrderedCacheBehavior[] = []

    if (www) {
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
    }
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
                    cookies: {
                        forward: "all",
                    },
                },
                minTtl: 0,
                defaultTtl: 60,
                maxTtl: 120,
                compress: true,
                viewerProtocolPolicy: "redirect-to-https",
            }
        )
    }

    // Note: CF certificates MUST be on us-east-1
    const useast1 = new aws.Provider("useast1", { region: "us-east-1" });
    const cert = customDomain ?
        pulumi.output(aws.acm.getCertificate({
            domain: customDomain[0],
        }, {
            provider: useast1
        })) : undefined

    // TODO: Set price tier

    return new aws.cloudfront.Distribution(`${projectName}-${environment}`, {
        enabled: true,
        origins: origins,
        aliases: customDomain ?? undefined,

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
            defaultTtl: 60,
            maxTtl: 120,
        },
        restrictions: {
            geoRestriction: {
                restrictionType: 'none'
            }
        },
        viewerCertificate: {
            cloudfrontDefaultCertificate: customDomain ? false : true,
            acmCertificateArn: cert?.arn
        },  
    })
}