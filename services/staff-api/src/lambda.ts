import awsLambdaFastify from "@fastify/aws-lambda";
import { buildApp } from "@gis/public-api/app";

const app = await buildApp();
await app.ready();
export const handler = awsLambdaFastify(app, { decorateRequest: false });
