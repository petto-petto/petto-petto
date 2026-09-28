import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

import { SqliteTokenClient } from '../clients/sqlite-token-client.ts';
import { CurrencyRepository } from '../persistence/repositories/currency-repository.ts';
import { TokenRepository } from '../persistence/repositories/token-repository.ts';
import { SqliteFileDatabase } from '../persistence/sqlite-file.ts';
import { grantAdminTokens, parseGrantAmount } from './grant-tokens.ts';

app.setName('tamagotchi-pet');

void app.whenReady().then(() => {
  let database: SqliteFileDatabase | undefined;
  let exitCode = 0;
  try {
    const amount = parseGrantAmount(process.argv.slice(2));
    const databasePath = join(app.getPath('userData'), 'petto.sqlite');
    if (!existsSync(databasePath)) throw new Error(`기존 앱 DB를 찾지 못했습니다: ${databasePath}`);
    database = new SqliteFileDatabase({ filePath: databasePath });
    database.open();
    const tokens = new SqliteTokenClient(
      new TokenRepository(database),
      new CurrencyRepository(database),
    );
    const result = grantAdminTokens(tokens, amount, `admin:grant:${randomUUID()}`);
    console.log(
      `토큰 ${amount.toLocaleString('ko-KR')} 지급 완료 ` +
        `(${result.previousBalance.toLocaleString('ko-KR')} → ${result.currentBalance.toLocaleString('ko-KR')})`,
    );
  } catch (error) {
    console.error(`토큰 지급 실패: ${String(error)}`);
    exitCode = 1;
  } finally {
    database?.close();
    app.exit(exitCode);
  }
});
