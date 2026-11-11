import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator'
import { Type } from 'class-transformer'

export class CreateReservationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  customerName!: string

  @IsString()
  @IsOptional()
  @MaxLength(30)
  customerPhone?: string

  @IsEmail()
  @IsOptional()
  customerEmail?: string

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  partySize!: number

  @IsDateString()
  startTime!: string

  @IsDateString()
  @IsOptional()
  endTime?: string

  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(480)
  @IsOptional()
  durationMinutes?: number

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('all', { each: true })
  tableIds!: string[]

  @IsString()
  @IsOptional()
  notes?: string
}

export class CheckAvailabilityDto {
  @IsDateString()
  startTime!: string

  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(480)
  @IsOptional()
  durationMinutes?: number

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  partySize?: number
}
