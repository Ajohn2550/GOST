# Local

Local builds and runs use Apple's `container` CLI. The image is a normal OCI image, so a shared host can run the same `Dockerfile`. Commands that build or run the container wait for a yes before they are issued.

`Dockerfile` and `CONTAINER.md` are part of the app build. They are not part of this docs pass. When they are added, they stay at the repository root and match this page.

## Dockerfile

The image is Node 22 on Debian bookworm. It installs dependencies, copies the app, and starts the server. SQLite comes from Node's built-in `node:sqlite` module. The image does not compile a native database addon. `node:sqlite` has been available without `--experimental-sqlite` since Node 22.13. Pin the image to the current Node 22 bookworm tag when the Dockerfile is written.

The server listens on port 8080. The data file defaults to `/data/gost.sqlite`.

## CONTAINER.md

`CONTAINER.md` will say what the container is for and which commands run in it. The set to record there:

- `npm install` — install dependencies inside the image build
- `npm run build` — compile TypeScript
- `npm test` — run the tests
- `npm start` — run the server

## Run

From the repository root, after a yes:

```sh
container build -t gost:dev -f Dockerfile .
container run --rm --name gost \
  -p 127.0.0.1:8080:8080 \
  -e PUBLIC_BASE_URL=http://127.0.0.1:8080 \
  -e SESSION_SECRET=local-dev-secret \
  -v "$(pwd)/data:/data" \
  gost:dev
```

The app is then at `http://127.0.0.1:8080`. The first page creates the admin. The SQLite file appears in `./data` on the host.

If the container system or the builder is not already running, these need their own yes before the build:

```sh
container system start --enable-kernel-install
container builder start -c 4 -m 8G
```

Tests use the same image, with the test command in place of the default server command, once `CONTAINER.md` lists that command.

## Host

Editing files, git, and reading these docs happen on the host. `npm`, `node`, the tests, and the server run in the container.
