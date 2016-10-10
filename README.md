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
