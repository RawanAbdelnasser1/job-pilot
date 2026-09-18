import express, { type Express } from "express";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();
const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

const sameOrigin = express.Router();
sameOrigin.use((req, res, next) => {
  if (safeMethods.has(req.method)) {
    next();
    return;
  }
  const origin = req.headers.origin;
  if (!origin) {
    next();
    return;
  }
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    res.status(403).json({ error: "Cross-origin request rejected" });
    return;
  }
  const requestHost = getClerkProxyHost(req)?.toLowerCase();
  if (!requestHost || originHost !== requestHost) {
    res.status(403).json({ error: "Cross-origin request rejected" });
    return;
  }
  next();
});

const requireJsonBody = express.Router();
requireJsonBody.use((req, res, next) => {
  if (safeMethods.has(req.method)) {
    next();
    return;
  }
  const hasBody =
    Number(req.headers["content-length"] ?? 0) > 0 ||
    Boolean(req.headers["transfer-encoding"]);
  if (
    hasBody &&
    !String(req.headers["content-type"] ?? "")
      .toLowerCase()
      .startsWith("application/json")
  ) {
    res.status(415).json({ error: "State-changing API bodies must be JSON" });
    return;
  }
  next();
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use("/api", sameOrigin);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", requireJsonBody, router);

export default app;
