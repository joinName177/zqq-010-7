import { ChatMessage } from '../core/models';

export interface ChatParserPort {
  parse(rawText: string): Promise<ChatMessage[]>;
}
