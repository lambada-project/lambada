---
title: AWS Configuration
sidebar_label: AWS
slug: /aws-config
---

## AWS Credentials
Instead of logging in every time the devcontainer is rebuilt, we recommend using a credentials file.


## Linux 
Get your AWS credentials and save them like so:

~/.aws/credentials
```
[default]
aws_access_key_id=AKIAIOSFODNN7EXAMPLE
aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

~/.aws/config
```
[default]
region=us-west-2
output=json
```


For more information and other OS go to [AWS Credentials file](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html)


## AWS Profiles
We recommend using profiles. Once you have it setup open `.devcontainer/Dockerfile` and replace `<profile-name>` with the name of your profile here

```dockerfile
ENV AWS_PROFILE=<profile-name>
```