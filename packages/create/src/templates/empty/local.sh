pulumi logout
mkdir -p .localstack
pulumi login file://./.localstack
PULUMI_CONFIG_PASSPHRASE=local pulumi up --stack localstack
