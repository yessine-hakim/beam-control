import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Subscription } from 'rxjs';
import type { Server } from 'socket.io';
import { BeamService } from '../beam/beam.service';

/** Pushes every tick to every open screen; screens send back only two commands. */
@WebSocketGateway({ cors: { origin: 'http://localhost:5173' } })
export class BeamGateway implements OnModuleInit, OnModuleDestroy {
  @WebSocketServer() private server!: Server;
  private readonly logger = new Logger('Gateway');
  private subscription: Subscription | null = null;

  constructor(private readonly beam: BeamService) {}

  onModuleInit() {
    this.subscription = this.beam.snapshot$.subscribe((snapshot) => this.server?.emit('snapshot', snapshot));
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
  }

  @SubscribeMessage('drill')
  drill() {
    const ok = this.beam.triggerDrill();
    this.logger.log(`Drill requested: ${ok ? 'launched' : 'no serving beam'}`);
    return { ok };
  }

  @SubscribeMessage('liveFeed')
  liveFeed(@MessageBody() body: { on?: unknown }) {
    return { live: this.beam.setLiveFeed(body?.on === true) };
  }
}
