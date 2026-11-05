import { MemoryDB } from './libs/fakedb';
import { correntistas } from './data/db.json';

export async function setupDatabase() {
  MemoryDB.create('COB', ['txid']);
  MemoryDB.create('COB_HIST', ['id']);
  MemoryDB.create('COBR', ['txid']);
  MemoryDB.create('COBV', ['txid']);
  MemoryDB.create('LOCATIONS', ['id', 'uuid']);
  MemoryDB.create('LOC_COB', ['id', 'txid']);
  MemoryDB.create('REC', ['idRec']);

  const corr = MemoryDB.create('CORRENTISTAS', ['chave', 'cpfcnpj']);
  await Promise.all(
    correntistas.map(async (c) => {
      await corr.add('DEV', c);
    }),
  );
}
