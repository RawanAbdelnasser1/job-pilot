import { Router, type IRouter } from "express";
import healthRouter from "./health";
import jobpilotRouter from "./jobpilot";
import tailoringRouter from "./tailoring";
import executionRouter from "./execution";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(requireAuth);
router.use(jobpilotRouter);
router.use(tailoringRouter);
router.use(executionRouter);

export default router;
