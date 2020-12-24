// FROM https://github.com/c-bandy/aws-secrets-manager-cache

import { SecretsManager } from 'aws-sdk';

const defaultTTL = (5 * 60 * 1000); // 5 minutes

export class CachedSecret {
    public readonly value: string;
    public readonly ttl: number;
    public readonly expiresAt: number;

    constructor(value: string, ttl: number) {
        this.value = value;
        this.ttl = ttl;
        this.expiresAt = Date.now() + ttl;
    }

    hasExpired(): boolean {
        return (Date.now() > this.expiresAt);
    }
}

export type SecretsManagerCacheOptions = Partial<SecretsManagerCacheConfig>

interface SecretsManagerCacheConfig {
    /**
     * How many milliseconds to cache each secret for.
     * @default 300000
     */
    ttl: number;
    /** AWS SDK SecretsManager instance */
    secretsManager: SecretsManager;
}

export class SecretsManagerCache {
    public config: SecretsManagerCacheConfig;
    private cache = new Map<string, CachedSecret>()

    constructor(options?: SecretsManagerCacheOptions) {
        this.config = {
            // set defaults
            ttl: defaultTTL,
            secretsManager: new SecretsManager(),
            // replace defaults with input options
            ...options,
        };
    }

    /**
     * Fetches a secret from SecretsManager and caches it as long as the given
     * `ttl`.
     */
    async getSecret(secretName: string, isJSON = false): Promise<string | undefined> {
        const itemExistsInCache = this.cache.has(secretName);
        const itemHasExpired = this.cache.get(secretName)?.hasExpired();

        if (!itemExistsInCache || itemHasExpired) {
            const getSecretValueResponse = await this.config.secretsManager
                .getSecretValue({ SecretId: secretName })
                .promise();

            if (getSecretValueResponse.SecretString) {
                this.cache.set(
                    secretName,
                    new CachedSecret(
                        getSecretValueResponse.SecretString,
                        this.config.ttl,
                    )
                );
            }
        }

        const secret = this.cache.get(secretName)?.value;

        if (isJSON) {
            try {
                return JSON.parse(secret as any);
            } catch (error) {
                throw new Error('Attempted to parse non-JSON secret string as JSON.')
            }
        }

        return secret;
    }

    private static _manager = new SecretsManagerCache()
    public static get() : SecretsManagerCache{
        return this._manager
    }
}