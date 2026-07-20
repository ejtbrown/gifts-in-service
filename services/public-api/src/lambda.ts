import awsLambdaFastify from "@fastify/aws-lambda";
import { buildApp } from "./app.js";

const app = await buildApp();
await app.ready();
export const handler = awsLambdaFastify(app, { decorateRequest: false });
