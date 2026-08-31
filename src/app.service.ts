import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return `<h1 style="color: Green; text-align: center;">Welcome to I-deliver backend</h1>`;
  }
}
