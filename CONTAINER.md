# GOST container

One container is one client's board. It runs the Node server. SQLite is stored at `/data/gost.sqlite`.

Commands that run in the container:

- `npm install` — install dependencies inside the image build
- `npm run build` — compile TypeScript
- `npm test` — run the tests
- `npm start` — run the server

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

Tests use the same image, with `npm test` in place of the default server command.
