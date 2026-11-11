import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);
const USERS_TABLE = process.env.USERS_TABLE || "booking_users";

export const handler = async (event) => {
  const rawEmail = event?.request?.userAttributes?.email;
  if (!rawEmail) {
    throw new Error("El correo electrónico es obligatorio para registrarse.");
  }

  const email = rawEmail.trim().toLowerCase();
  const nowEpoch = Math.floor(Date.now() / 1000);

  // Consultar si el correo electrónico está dado de baja (DEACTIVATED) dentro del período de 1 año
  const result = await docClient.send(
    new QueryCommand({
      TableName: USERS_TABLE,
      IndexName: "email-index",
      KeyConditionExpression: "email = :email",
      ExpressionAttributeValues: {
        ":email": email,
      },
    })
  );

  const items = result.Items || [];
  const deactivatedRecord = items.find(
    (u) => u.status === "DEACTIVATED" && (!u.ttl || u.ttl > nowEpoch)
  );

  if (deactivatedRecord) {
    throw new Error(
      "No es posible crear una cuenta con este correo electrónico porque se encuentra dado de baja. Solicite la reactivación al administrador del edificio."
    );
  }

  // Si el registro proviene de un proveedor externo federado (Google SSO), el email ya viene verificado por Google
  if (event.triggerSource === "PreSignUp_ExternalProvider") {
    event.response.autoConfirmUser = true;
    event.response.autoVerifyEmail = true;
  }

  return event;
};

