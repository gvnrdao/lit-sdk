import {
  SessionSigsMap,
  ILitNodeClient,
} from '@lit-protocol/types';
import { ENCRYPTED_PRIVATE_KEY_ENDPOINT } from './constants';
import { encryptString } from '@lit-protocol/encryption';
import { log, logError } from '@lit-protocol/misc';
import {
  LitMessage,
  LitTransaction,
  getFirstSessionSig,
  getPkpAccessControlCondition,
  getPkpAddressFromSessionSig,
} from './utils';

interface ImportPrivateKeyParams {
  pkpSessionSigs: SessionSigsMap;
  privateKey: string;
  litNodeClient: ILitNodeClient;
}
interface ImportPrivateKeyResponse {
  pkpAddress: string;
}

interface SignWithEncryptedKeyParams<T> {
  pkpSessionSigs: SessionSigsMap;
  litActionCid: string;
  unsignedTransaction: T;
  litNodeClient: ILitNodeClient;
}

export async function importPrivateKey({
  pkpSessionSigs,
  privateKey,
  litNodeClient,
}: ImportPrivateKeyParams): Promise<string> {
  const firstSessionSig = getFirstSessionSig(pkpSessionSigs);
  const pkpAddress = getPkpAddressFromSessionSig(firstSessionSig);
  const allowPkpAddressToDecrypt = getPkpAccessControlCondition(pkpAddress);

  const { ciphertext, dataToEncryptHash } = await encryptString(
    {
      accessControlConditions: allowPkpAddressToDecrypt,
      dataToEncrypt: privateKey,
    },
    litNodeClient
  );

  const data = {
    ciphertext,
    dataToEncryptHash,
  };

  try {
    const response = await fetch(ENCRYPTED_PRIVATE_KEY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        pkpsessionsig: JSON.stringify(firstSessionSig),
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logError(
        `Could not import the encrypted key due to the error: ${errorBody}`
      );

      throw new Error(errorBody);
    }

    const importedPrivateKey: ImportPrivateKeyResponse = await response.json();
    return importedPrivateKey.pkpAddress;
  } catch (error) {
    const errorMessage = `There was a problem fetching from the database: ${error}`;
    console.error(errorMessage);

    throw new Error(errorMessage);
  }
}

export async function signWithEncryptedKey<T = LitMessage | LitTransaction>({
  pkpSessionSigs,
  litActionCid,
  unsignedTransaction,
  litNodeClient,
}: SignWithEncryptedKeyParams<T>): Promise<string> {
  const firstSessionSig = getFirstSessionSig(pkpSessionSigs);

  let responseData;

  try {
    const response = await fetch(ENCRYPTED_PRIVATE_KEY_ENDPOINT, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        pkpsessionsig: JSON.stringify(firstSessionSig),
      },
    });

    responseData = await response.json();

    if (!response.ok) {
      log(
        `Could not fetch the encrypted key from the database due to the error: ${responseData}`
      );
    }
  } catch (error) {
    console.error(`There was a problem fetching from the database: ${error}`);
  }

  const { pkpAddress, ciphertext, dataToEncryptHash } = responseData;

  const result = await litNodeClient.executeJs({
    sessionSigs: pkpSessionSigs,
    ipfsId: litActionCid,
    jsParams: {
      pkpAddress,
      ciphertext,
      dataToEncryptHash,
      unsignedTransaction,
    },
  });

  log(`Lit Action result: ${result}`);

  if (!result) {
    throw new Error('There was some error running the Lit Action');
  }

  if (typeof result.response !== 'string') {
    throw new Error('Lit Action should return a string response');
  }

  return result.response;
}
