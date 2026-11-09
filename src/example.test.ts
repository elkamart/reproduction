import 'reflect-metadata';
import { Entity, OneToOne, PrimaryKey, Property, ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { MikroORM, Opt, Ref, Type, wrap } from '@mikro-orm/sqlite';

// A value object used as primary key, mapped to a plain string column.
class OrderId {

  constructor(readonly value: string) {}

}

class OrderIdType extends Type<OrderId | null | undefined, string | null | undefined> {

  override convertToDatabaseValue(value: OrderId | string | null | undefined): string | null | undefined {
    if (value == null) {
      return value;
    }

    return typeof value === 'string' ? value : value.value;
  }

  override convertToJSValue(value: string | null | undefined): OrderId | null | undefined {
    return value == null ? value : new OrderId(value);
  }

  override compareAsType(): string {
    return 'string';
  }

  override getColumnType(): string {
    return 'text';
  }

}

@Entity()
class Order {

  @PrimaryKey({ type: OrderIdType })
  id!: OrderId;

  @OneToOne({ entity: () => Draft, mappedBy: 'order', ref: true, nullable: true })
  draft?: Ref<Draft>;

}

@Entity()
class Draft {

  @PrimaryKey()
  id!: string;

  @OneToOne({ entity: () => Order, inversedBy: 'draft', ref: true, nullable: true })
  order?: Ref<Order>;

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date & Opt = new Date(0);

}

let orm: MikroORM;

beforeAll(async () => {
  orm = await MikroORM.init({
    dbName: ':memory:',
    entities: [Order, Draft],
    metadataProvider: ReflectMetadataProvider,
    debug: ['query', 'query-params'],
    allowGlobalContext: true, // only for testing
  });
  await orm.schema.refresh();

  const order = orm.em.create(Order, { id: new OrderId('order_1') });
  orm.em.create(Draft, { id: 'draft_1', order });
  await orm.em.flush();
  orm.em.clear();
});

afterAll(async () => {
  await orm.close(true);
});

beforeEach(() => orm.em.clear());

function pendingChangeSets() {
  const uow = orm.em.getUnitOfWork();
  uow.computeChangeSets();
  return uow.getChangeSets().map(cs => ({ entity: cs.meta.className, payload: cs.payload }));
}

test('loading only the inverse side leaves the auto-joined owner clean', async () => {
  const order = await orm.em.findOneOrFail(Order, { id: new OrderId('order_1') });
  const draft = order.draft!.unwrap();
  expect(wrap(draft).isInitialized()).toBe(false);

  // The FK snapshot is seeded while the hydrator propagates the inverse side.
  // It should hold the database value of the PK, like any other FK snapshot.
  expect(wrap(draft, true).__originalEntityData).toEqual({ id: 'draft_1', order: 'order_1' });

  // Nothing was changed, so nothing should be written.
  expect(pendingChangeSets()).toEqual([]);
});

test('populating the owner from the inverse side leaves it clean', async () => {
  const order = await orm.em.findOneOrFail(Order, { id: new OrderId('order_1') }, { populate: ['draft'] });
  const draft = order.draft!.unwrap();
  expect(wrap(draft).isInitialized()).toBe(true);

  expect(wrap(draft, true).__originalEntityData!.order).toBe('order_1');
  expect(pendingChangeSets()).toEqual([]);
});

test('flushing after a plain read does not touch the owner row', async () => {
  await orm.em.findOneOrFail(Order, { id: new OrderId('order_1') }, { populate: ['draft'] });
  await orm.em.flush();
  orm.em.clear();

  // `updatedAt` only moves when an UPDATE hits the draft row.
  const draft = await orm.em.findOneOrFail(Draft, { id: 'draft_1' });
  expect(draft.updatedAt.getTime()).toBe(0);
});
