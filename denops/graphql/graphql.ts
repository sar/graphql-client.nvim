import { Denops, fs } from "./deps.ts";
import { ensureBuffer } from "./vim/ensures.ts";
import { configFile, hasConfig, readConfig } from "./config.ts";

const endpoints: Record<string, string> = {};

const openVariableBuffer = async (denops: Denops, bufname: string) => {
  await ensureBuffer(
    denops,
    "botright 10new",
    bufname,
    async () => {
      await denops.cmd(
        "setlocal ft=json buftype=nofile | nnoremap <buffer> q :q<CR>",
      );
    },
  );
};

const openRespBuffer = async (denops: Denops, bufname: string) => {
  await ensureBuffer(denops, "botright vnew", bufname, async () => {
    await denops.cmd(
      "setlocal ft=json buftype=nofile | nnoremap <buffer> q :bw!<CR>",
    );
  });
};

export async function edit(denops: Denops): Promise<void> {
  const ft = await denops.eval("&ft");
  if (ft !== "graphql") {
    throw new Error(`file type is not 'graphql': ${ft}`);
  }

  const fname = await denops.call("bufname");
  if (!fname) {
    throw new Error("file name is empty");
  }

  await openVariableBuffer(denops, `${fname}.variables`);
  await openRespBuffer(denops, `${fname}.output`);
}

export async function execute(denops: Denops): Promise<void> {
  if (await denops.eval("&ft") !== "graphql") {
    throw new Error(`file type is not 'graphql'`);
  }
  const queryBufName = await denops.call("bufname") as string;
  const endpoint = endpoints[queryBufName];
  if (!endpoint) {
    throw new Error(
      "not found endpoint, please set endpoint by :GraphQLSetEndpoint",
    );
  }

  const respBufName = `${queryBufName}.output`;
  await openRespBuffer(denops, respBufName);

  const query =
    (await denops.call("getbufline", queryBufName, 1, "$") as string[])
      .join("\n");

  const variableBufName = `${queryBufName}.variables`;
  let variables = "";
  if (await denops.call("bufexists", variableBufName)) {
    await openVariableBuffer(denops, variableBufName);
    variables = (await denops.call(
      "getbufline",
      variableBufName,
      1,
      "$",
    ) as string[])
      .join("\n");
  }

  let headers = {
    "Content-Type": "application/json",
  };

  if (await hasConfig()) {
    const httpConfigs = await readConfig();
    for (const config of httpConfigs) {
      if (endpoint === config.endpoint) {
        headers = { ...headers, ...config.headers };
      }
    }
  }

  console.log("executing...");
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: headers,
    body: JSON.stringify({
      query: query,
      variables: variables ? JSON.parse(variables) : null,
    }),
  });

  if (!resp.ok) {
    throw new Error(`network response is not ok: ${await resp.text()}`);
  }

  const body = JSON.stringify(await resp.json(), null, "  ");
  await denops.batch(
    ["deletebufline", respBufName, 1, "$"],
    ["setbufline", respBufName, 1, body.split("\n")],
  );
  await denops.cmd("redraw! | echo ''");
}

export async function setEndpoint(denops: Denops, arg: unknown): Promise<void> {
  const bufname = await denops.call("bufname") as string;
  endpoints[bufname] = arg as string;
}

export async function editHttpHeader(
  denops: Denops,
): Promise<void> {
  fs.ensureFile(configFile);
  await denops.cmd(`new ${configFile}`);
}
