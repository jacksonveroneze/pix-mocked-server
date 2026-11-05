import { randomUUID } from 'crypto';
import { setupDatabase } from '../src/database';
import { MemoryDB } from '../src/libs/fakedb';
import { PSP } from '../src/core/app/psp';
import { correntistas } from '../src/data/db.json';

describe('setupDatabase', () => {
  let psp: PSP;

  beforeAll(async () => {
    await setupDatabase();
    psp = new PSP();
  });

  it.each([
    'COB',
    'COB_HIST',
    'COBR',
    'COBV',
    'LOCATIONS',
    'LOC_COB',
    'REC',
    'CORRENTISTAS',
  ])('cria a coleção %s', (name) => expect(MemoryDB.get(name)).toBeDefined());

  it('carrega os correntistas', async () => {
    await expect(
      MemoryDB.get('CORRENTISTAS').read('DEV', {
        chave: correntistas[0].chave,
      }),
    ).resolves.toMatchObject(correntistas[0]);
    await expect(
      MemoryDB.get('CORRENTISTAS').read('DEV', {
        cpfcnpj: correntistas[0].cpfcnpj,
      }),
    ).resolves.toMatchObject(correntistas[0]);
  });

  describe('PSP sobre as coleções criadas', () => {
    const IdOwner = randomUUID();
    const txid = randomUUID().replace(/\-/g, '');
    const chave = correntistas[0].chave;

    it('addCob', async () => {
      await expect(
        psp.addCob({
          IdOwner,
          txid,
          data: { chave, valor: { original: '10.00' } },
        }),
      ).resolves.toMatchObject({ txid, chave });
    });

    it('editCob', async () => {
      await expect(
        psp.editCob({
          IdOwner,
          txid,
          data: { solicitacaoPagador: 'alterada' },
        }),
      ).resolves.toMatchObject({ txid, solicitacaoPagador: 'alterada' });
    });

    it('listCob filtrando por cnpj', async () => {
      const inicio = new Date(Date.now() - 60000).toJSON();
      const fim = new Date(Date.now() + 60000).toJSON();
      const res = await psp.listCob({
        IdOwner,
        inicio,
        fim,
        cnpj: correntistas[0].cpfcnpj,
      } as any);
      expect(res.cobs).toEqual(
        expect.arrayContaining([expect.objectContaining({ txid })]),
      );
    });
  });
});
