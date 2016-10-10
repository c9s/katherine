# Delivery

Continuous Meteor Deployment Integration bases on Typeloy <https://github.com/c9s/typeloy>

Typeloy is a re-written development tool from "mup" with TypeScript 2.0. In order to make Typeloy to be easy to be integrated with other applications,
we refactored Typeloy with a nice action API.

And therefore, **Delivery** can use Typeloy API to ship the softwares to the target servers.

## Features

- Slack Integration.
- Auto-Deploy Integration.
- Support multiple deploy workers base on Redis.

## Screenshots

![Imgur](http://i.imgur.com/Y4y9CSK.png)

## Install

Step1, git clone the repository

    git clone https://github.com/kaneoh/delivery
    cd delivery
    
Step2, install the depenedencies:

    npm install -g typescript
    npm install -g typeloy
    npm install
    npm link typeloy
    
Step3, get the oauth slack token from https://NAME.slack.com/apps/build "Make a Custom Integration".

    export SLACK_API_TOKEN=xxxx-xxxxxxxxxxxxxxxxxxx

Step4: Setup a SSH key with ssh-agent (or you can use keychain), to make sure you can clone your app repo without entering password.

    git clone git@github.com:your/app.git  # should be done without entering password.

Step5: setup config file:

- delivery.json: see the example config below.
- typeloy.json:  the same config for deploying meteor app with typeloy.

Step6: Run!

    node lib/bin/slack.js

## Commands

    @botname: please deploy {appName} from {branchName} branch to {siteName}

## Example Config

```json
{
    "pool": {
        "worker1": "./pool1",
        "worker2": "./pool2",
        "worker3": "./pool3"
    },
    "source": {
        "repository": "git@github.com:aaa/bbb.git",
        "branch": "master"
    },
    "web": {
        "accessTokens": ["xxxxxxxxx"]
    },
}
```
