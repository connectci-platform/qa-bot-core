import {
  AgentTokenError,
  FAILED_MINT_FLOOR_MS,
  FOCUS_REFRESH_MIN_MS,
  REFRESH_MARGIN_MS,
  createAgentTokenSource,
  getAgentTokenSource,
} from "./agent-token";

function response(
  status: number,
  body: unknown = {},
  headers: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: () => Promise.resolve(body),
  } as Response;
}

const minted = (token: string, expiresIn = 900) =>
  response(200, {
    access_token: token,
    token_type: "Bearer",
    expires_in: expiresIn,
  });

function setup(...responses: (Response | Error)[]) {
  let t = 1_000_000;
  const clock = {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
  const fetchImpl = jest.fn();
  for (const r of responses) {
    if (r instanceof Error) fetchImpl.mockRejectedValueOnce(r);
    else fetchImpl.mockResolvedValueOnce(r);
  }
  const source = createAgentTokenSource({
    tokenUrl: "https://support.example/api/agent-token",
    now: clock.now,
    fetchImpl,
  });
  return { source, fetchImpl, clock };
}

describe("createAgentTokenSource", () => {
  it("mints from the token URL with the contract's request options", async () => {
    const { source, fetchImpl } = setup(minted("t1"));
    expect(await source.getToken()).toBe("t1");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://support.example/api/agent-token",
      {
        method: "POST",
        credentials: "include",
        referrerPolicy: "strict-origin-when-cross-origin",
      },
    );
    expect(source.getStatus()).toBe("signed_in");
  });

  it("reuses the token until fewer than 180 seconds remain", async () => {
    const { source, fetchImpl, clock } = setup(minted("t1"), minted("t2"));
    await source.getToken();
    clock.advance(900_000 - REFRESH_MARGIN_MS);
    expect(await source.getToken()).toBe("t1");
    clock.advance(1);
    expect(await source.getToken()).toBe("t2");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("times the token from receipt plus expires_in", async () => {
    const { source, clock, fetchImpl } = setup(minted("t1", 300), minted("t2"));
    await source.getToken();
    clock.advance(300_000 - REFRESH_MARGIN_MS + 1);
    expect(await source.getToken()).toBe("t2");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight mint between concurrent callers", async () => {
    const { source, fetchImpl } = setup(minted("t1"));
    const tokens = await Promise.all([
      source.getToken(),
      source.getToken(),
      source.getToken(),
    ]);
    expect(tokens).toEqual(["t1", "t1", "t1"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("treats login_required as signed out and stops minting until refresh", async () => {
    const { source, fetchImpl } = setup(
      response(401, { error: "login_required" }),
      minted("t1"),
    );
    expect(await source.getToken()).toBeNull();
    expect(source.getStatus()).toBe("signed_out");
    expect(await source.getToken()).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    expect(await source.refresh()).toBe("t1");
    expect(source.getStatus()).toBe("signed_in");
  });

  it("goes signed out when a later mint says login_required", async () => {
    const { source } = setup(minted("t1"), response(401));
    await source.getToken();
    expect(await source.refresh()).toBeNull();
    expect(source.getStatus()).toBe("signed_out");
  });

  it("notifies subscribers when the status changes", async () => {
    const { source } = setup(minted("t1"), response(401));
    const listener = jest.fn();
    const unsubscribe = source.subscribe(listener);
    await source.getToken();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    await source.refresh();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("re-mints for a stale token only once", async () => {
    const { source, fetchImpl } = setup(minted("t1"), minted("t2"));
    await source.getToken();
    const [a, b] = await Promise.all([
      source.refresh("t1"),
      source.refresh("t1"),
    ]);
    expect([a, b]).toEqual(["t2", "t2"]);
    expect(await source.refresh("t1")).toBe("t2");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["a network error", new TypeError("Failed to fetch")],
    ["a 5xx", response(500, { error: "server_error" })],
    ["a body without a token", response(200, { token_type: "Bearer" })],
    [
      "a non-positive expires_in",
      response(200, { access_token: "t", expires_in: 0 }),
    ],
  ])(
    "reports %s as temporary and doesn't mint again within the floor",
    async (_, first) => {
      const { source, fetchImpl, clock } = setup(first, minted("t1"));
      await expect(source.getToken({ strict: true })).rejects.toMatchObject({
        kind: "temporary",
      });
      await expect(source.getToken({ strict: true })).rejects.toBeInstanceOf(
        AgentTokenError,
      );
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(source.getStatus()).toBe("unknown");

      clock.advance(FAILED_MINT_FLOOR_MS);
      expect(await source.getToken()).toBe("t1");
    },
  );

  it("lets a user not yet seen signed in continue anonymously when the mint fails", async () => {
    const { source } = setup(response(503), response(403));
    expect(await source.getToken()).toBeNull();
    expect(source.getStatus()).toBe("unknown");
    expect(await source.refresh().catch(() => "threw")).toBe("threw");
    expect(await source.getToken()).toBeNull();
  });

  it("fails a signed-in user's request when the re-mint fails", async () => {
    const { source, clock } = setup(minted("t1"), response(500));
    await source.getToken();
    clock.advance(900_000 - REFRESH_MARGIN_MS + 1);
    await expect(source.getToken()).rejects.toMatchObject({
      kind: "temporary",
    });
    expect(source.getStatus()).toBe("signed_in");
  });

  it("lets an explicit refresh retry a temporary failure", async () => {
    const { source } = setup(response(503), minted("t1"));
    await expect(source.getToken({ strict: true })).rejects.toMatchObject({
      kind: "temporary",
    });
    expect(await source.refresh()).toBe("t1");
  });

  it("waits out Retry-After on a 429, even for refresh", async () => {
    const { source, fetchImpl, clock } = setup(
      response(429, { error: "slow_down" }, { "Retry-After": "120" }),
      minted("t1"),
    );
    await expect(source.getToken({ strict: true })).rejects.toMatchObject({
      kind: "rate_limited",
    });
    clock.advance(119_999);
    await expect(source.refresh()).rejects.toMatchObject({
      kind: "rate_limited",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    clock.advance(1);
    expect(await source.getToken()).toBe("t1");
  });

  it("never retries a 403", async () => {
    const { source, fetchImpl, clock } = setup(
      response(403, { error: "invalid_origin" }),
    );
    await expect(source.getToken({ strict: true })).rejects.toMatchObject({
      kind: "refused",
    });
    clock.advance(24 * 60 * 60 * 1000);
    await expect(source.refresh()).rejects.toMatchObject({ kind: "refused" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("doesn't re-mint for a 401 on a token that a later mint replaced with signed out", async () => {
    const { source, fetchImpl } = setup(minted("t1"), response(401));
    await source.getToken();
    expect(await source.refresh("t1")).toBeNull();
    expect(await source.refresh("t1")).toBeNull();
    expect(await source.refresh("t1")).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("doesn't mint until a token is asked for", () => {
    const { fetchImpl } = setup(minted("t1"));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps the status unknown after a failure and reports it", async () => {
    const { source } = setup(response(503));
    expect(await source.getToken()).toBeNull();
    expect(source.getStatus()).toBe("unknown");
    expect(source.lastFailure()).toBe("temporary");
  });

  it("clears the failure once a mint succeeds", async () => {
    const { source, clock } = setup(response(503), minted("t1"));
    await source.getToken();
    clock.advance(FAILED_MINT_FLOOR_MS);
    await source.getToken();
    expect(source.lastFailure()).toBeNull();
  });

  it("treats a user who got a 429 as signed in, so failures stay strict", async () => {
    const { source, clock } = setup(
      response(429, { error: "slow_down" }, { "Retry-After": "1" }),
      response(503),
    );
    await expect(source.getToken()).rejects.toMatchObject({ kind: "rate_limited" });
    clock.advance(1000);
    await expect(source.getToken()).rejects.toMatchObject({ kind: "temporary" });
  });

  it("forgets a signed-in user after login_required", async () => {
    const { source, clock } = setup(minted("t1"), response(401), response(503));
    await source.getToken();
    await source.refresh();
    expect(source.getStatus()).toBe("signed_out");
    clock.advance(FOCUS_REFRESH_MIN_MS);
    await expect(source.refresh()).rejects.toMatchObject({ kind: "temporary" });
    expect(await source.getToken()).toBeNull();
  });
});

describe("refreshOnFocus", () => {
  async function signedOut() {
    const s = setup(response(401), minted("t1"), minted("t2"));
    await s.source.getToken();
    return s;
  }

  it("does nothing before the chat is opened", async () => {
    const { source, fetchImpl } = await signedOut();
    source.refreshOnFocus();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("re-mints a signed-out user once the chat has been opened", async () => {
    const { source, fetchImpl } = await signedOut();
    source.noteOpened();
    source.refreshOnFocus();
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("re-mints at most once a minute", async () => {
    const { source, fetchImpl, clock } = setup(response(401), response(401), response(401));
    await source.getToken();
    source.noteOpened();
    source.refreshOnFocus();
    await new Promise((r) => setTimeout(r, 0));
    source.refreshOnFocus();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    clock.advance(FOCUS_REFRESH_MIN_MS);
    source.refreshOnFocus();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does nothing while signed in", async () => {
    const { source, fetchImpl } = setup(minted("t1"));
    await source.getToken();
    source.noteOpened();
    source.refreshOnFocus();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("getAgentTokenSource", () => {
  it("shares one source per token URL", () => {
    const a = getAgentTokenSource("https://one.example/api/agent-token");
    expect(getAgentTokenSource("https://one.example/api/agent-token")).toBe(a);
    expect(getAgentTokenSource("https://two.example/api/agent-token")).not.toBe(a);
  });
});

describe("fixes from review", () => {
  it("does not treat a 429 without the identity site's error as signed in", async () => {
    const { source, clock } = setup(response(429, {}, { "Retry-After": "1" }), response(503));
    await expect(source.getToken()).resolves.toBeNull();
    clock.advance(1000);
    await expect(source.getToken()).resolves.toBeNull();
  });

  it("tells subscribers about a failure even when the status is unchanged", async () => {
    const { source } = setup(response(503));
    const listener = jest.fn();
    source.subscribe(listener);
    await source.getToken();
    expect(source.getStatus()).toBe("unknown");
    expect(listener).toHaveBeenCalled();
  });

  it("makes a late 401 wait for a mint already in flight", async () => {
    let release: (r: Response) => void = () => {};
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(minted("t1"))
      .mockImplementationOnce(() => new Promise<Response>((r) => { release = r; }));
    const source = createAgentTokenSource({ tokenUrl: "https://support.example/api/agent-token", fetchImpl });
    await source.getToken();
    const fresh = source.refresh();
    const late = source.refresh("an-older-token");
    release(minted("t2"));
    expect(await fresh).toBe("t2");
    expect(await late).toBe("t2");
  });
});
