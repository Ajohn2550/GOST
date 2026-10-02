# Hosting

One shared machine can run many clients. Each client is one container, one SQLite volume, and one site on the reverse proxy. The app inside the container does not choose a tenant from the hostname.

A subdomain and a custom domain are the same kind of site. The name resolves to the machine, and the proxy forwards that name to that client's container. Caddy obtains TLS for the names listed in its config.

Adding a client is done by hand. This repository does not ship a provisioner, a control plane, or billing.

## Image

Build the OCI image from the repository `Dockerfile`. The same image is every client. Clients differ by environment and by the volume mounted at their data path.

The process listens on port 8080 inside the container. Publish that port on the host loopback only, one host port per client. The public internet reaches Caddy, not the app ports.

## Environment

Set these on every container.

| Name | Required | Purpose |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | Yes | Origin for links, with no path. Example: `https://alpha.example.com` |
| `SESSION_SECRET` | Yes | Long random secret mixed into session token hashes. The process exits when this is missing |
| `DATA_PATH` | No | SQLite file. Default `/data/gost.sqlite` |
| `PORT` | No | Listen port inside the container. Default `8080` |

Use a different `SESSION_SECRET` for each client. Use a `PUBLIC_BASE_URL` that matches the proxy site name, including `https`.

## Volume

Mount a host directory on `/data` in the container. The SQLite file and its WAL files live there. Back up that directory while the container is stopped, or use SQLite's online backup against `DATA_PATH`.

## Proxy

Caddy is the reverse proxy on the host. Each client is one site block. The block's upstream is that client's loopback port.

Two clients, one on a subdomain and one on a custom domain:

```caddyfile
alpha.example.com {
	reverse_proxy 127.0.0.1:18081
}

board.acme.com {
	reverse_proxy 127.0.0.1:18082
}
```

`alpha.example.com` is a name you control. Point its DNS at the host, and set the container's `PUBLIC_BASE_URL` to `https://alpha.example.com`.

`board.acme.com` is a customer's name. They create a DNS record that points the name at the host. You add the site block, and you set that container's `PUBLIC_BASE_URL` to `https://board.acme.com`. Caddy handles the certificate for the name in the site block.

Give the next client the next loopback port and another volume. Reload Caddy after the site block is added.

## What stays manual

- DNS for the name
- The container, its env, its volume, and its loopback port
- The Caddy site block
- Backups of `/data`
- Replacing the image and restarting each client when the app changes

The app will not create containers, edit DNS, or issue certificates.
