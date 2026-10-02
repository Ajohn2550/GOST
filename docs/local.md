# Local

Local builds and runs use Apple's `container` CLI. The image is a normal OCI image, so a shared host can run the same `Dockerfile`. Commands that build or run the container wait for a yes before they are issued.

`Dockerfile` and `CONTAINER.md` live at the repository root. `CONTAINER.md` is the short copy of the commands below.

## Dockerfile

The image is Node 22 on Debian bookworm. It installs dependencies, copies the app, and starts the server. SQLite comes from Node's built-in `node:sqlite` module. The image does not compile a native database addon. `node:sqlite` has been available without `--experimental-sqlite` since Node 22.13. The image is pinned to the current Node 22 bookworm tag.

The server listens on port 8080 inside the container. The data file defaults to `/data/gost.sqlite`.

## Run

From the repository root, after a yes, create the data folder and start the server in the background:

```sh
mkdir -p data
container build -t gost:dev -f Dockerfile .
container run -d --rm --name gost \
  -p 127.0.0.1:8080:8080 \
  -e PUBLIC_BASE_URL=http://127.0.0.1:8080 \
  -e SESSION_SECRET=local-dev-secret \
  -v "$(pwd)/data:/data" \
  gost:dev
```

The app is at `http://127.0.0.1:8080`. The first page creates the admin. The SQLite file appears in `./data` on the host.

Stop that container by name. `--rm` deletes the container after the stop. The `./data` folder remains.

```sh
container stop gost
```

`container logs gost` shows the server output.

Start with `-d`. Stopping an attached `container run` with Ctrl+C often fails in Apple's CLI with `missing signal in xpc message`. The CLI then quits, and the server keeps running. `container list` shows the leftover container. Stop it by the `--name` you used.

## A second checkout

Each checkout gets its own container name, its own host port, and its own `./data` directory. They share the `gost:dev` image. Set `PUBLIC_BASE_URL` to the host port in `-p`.

```sh
mkdir -p data
container run -d --rm --name gost-johnson \
  -p 127.0.0.1:8081:8080 \
  -e PUBLIC_BASE_URL=http://127.0.0.1:8081 \
  -e SESSION_SECRET=local-dev-secret \
  -v "$(pwd)/data:/data" \
  gost:dev
```

Open `http://127.0.0.1:8081`. Stop it with `container stop gost-johnson`.

Node may print `ExperimentalWarning: SQLite is an experimental feature`. The following line, `GOST listening on 0.0.0.0:8080`, means the server started. With `-d`, that line is in `container logs`, not in the terminal where you typed `run`.

## Builder

If the container system or the builder is not already running, these need their own yes before the build:

```sh
container system start --enable-kernel-install
container builder start -c 4 -m 8G
```

## Tests

Tests use the same image and exit when they finish:

```sh
container run --rm --name gost-test gost:dev npm test
```

## Host

Editing files, git, and reading these docs happen on the host. `npm`, `node`, the tests, and the server run in the container.
