# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the device passwords of the controllers are `secret` fields of
  the Gladys configuration. The integration reads them from Gladys at
  startup, keeps them in memory, sends only their MD5 hash, and only to the
  controller they belong to (the `pw` parameter of the OpenSprinkler API). It
  never writes the password nor its hash to `/data` nor to the logs; error
  messages name the API endpoint, never the URL.
- **Stored in `/data`**: `opensprinkler-state.json`, per configured slot the
  controller address, its MAC address and its structure (station and program
  names, sensor types, firmware), and the water meter totals. No password.
- **Network**: requests go only to the controller addresses typed in the
  configuration, on the local network, in HTTP (the OpenSprinkler firmware
  serves no HTTPS; an `https://` address is accepted for a controller behind
  a proxy, its certificate is verified). The integration opens no port and
  calls no cloud service. The password hash travels unencrypted on the LAN,
  as with the official app.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the OpenSprinkler firmware and apps, and the other devices and services of
your network.
