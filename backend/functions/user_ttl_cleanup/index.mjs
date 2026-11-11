import {
  CognitoIdentityProviderClient,
   ListUsersCommand,
  AdminDeleteUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";

const cognito = new CognitoIdentityProviderClient({});
const USER_POOL_ID = process.env.USER_POOL_ID;

export const handler = async (event) => {
  if (!USER_POOL_ID) return;

  for (const record of event.Records || []) {
    if (record.eventName !== "REMOVE") continue;

    const oldImage = record.dynamodb?.OldImage;
    const status = oldImage?.status?.S;
    const email = oldImage?.email?.S;

    // Cuando un usuario dado de baja (DEACTIVATED) se elimina definitivamente tras 1 año (TTL)
    if (status === "DEACTIVATED" && email) {
      try {
        const listRes = await cognito.send(
          new ListUsersCommand({
            UserPoolId: USER_POOL_ID,
            Filter: `email = "${email}"`,
          })
        );

        for (const u of listRes.Users || []) {
          if (u.Username) {
            await cognito.send(
              new AdminDeleteUserCommand({
                UserPoolId: USER_POOL_ID,
                Username: u.Username,
              })
            );
          }
        }
      } catch (err) {
        console.error(`Error limpiando usuario en Cognito (${email}):`, err);
      }
    }
  }
};

