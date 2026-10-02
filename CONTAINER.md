# GOST container

One container is one client's board. It runs the Node server. SQLite is stored at `/data/gost.sqlite`.

Commands that run in the container:

- `npm install` — install dependencies inside the image build
- `npm run build` — compile TypeScript
- `npm test` — run the tests
- `npm start` — run the server

From the repository root, create the data folder, build the image, and start the server in the background:

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

The board is at `http://127.0.0.1:8080`. The first page creates the admin. The database file is `./data/gost.sqlite` in this checkout.

Stop it by name. `--rm` removes the container after it stops. The data folder stays.

```sh
container stop gost
```

Logs:

```sh
container logs gost
```

Leave the server detached. Ctrl+C on an attached `container run` often fails inside Apple's CLI (`missing signal in xpc message`) and exits the terminal while the server keeps running. If that happens, `container list` still shows it. Stop that name, then start again with `-d`.

A second checkout uses the same `gost:dev` image and its own name, host port, and data folder. Point `PUBLIC_BASE_URL` at the host port you published:

```sh
container run -d --rm --name gost-johnson \
  -p 127.0.0.1:8081:8080 \
  -e PUBLIC_BASE_URL=http://127.0.0.1:8081 \
  -e SESSION_SECRET=local-dev-secret \
  -v "$(pwd)/data:/data" \
  gost:dev
```

That copy is at `http://127.0.0.1:8081`. Stop it with `container stop gost-johnson`.

Node may print `ExperimentalWarning: SQLite is an experimental feature`. The server is up when the log says it is listening.

Tests use the same image. The test container exits on its own:

```sh
container run --rm --name gost-test gost:dev npm test
```
