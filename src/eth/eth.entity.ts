import { DecimalTransformer } from "src/transformers/decimal.transformer";
import { Column, Entity, PrimaryColumn } from "typeorm";


export class CandleEntity {

  @PrimaryColumn({
    type: 'bigint',
  })
  time: number;


  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: false,
    transformer: new DecimalTransformer()
  })
  open: number;


  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: false,
    transformer: new DecimalTransformer()
  })
  close: number;


  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: false,
    transformer: new DecimalTransformer()
  })
  high: number;


  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    nullable: false,
    transformer: new DecimalTransformer()
  })
  low: number;

  @Column({
    type: 'decimal',
    precision: 16,
    scale: 8,
    nullable: false,
    transformer: new DecimalTransformer()
  })
  volume: number;
}

@Entity()
export class EthMinuteCandle extends CandleEntity {


}
