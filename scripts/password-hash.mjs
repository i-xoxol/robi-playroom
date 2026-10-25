import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { passwordHash } from '../lib/core.mjs';
const output=new Writable({write(chunk,encoding,done){done();}});
const terminal=createInterface({input:process.stdin,output,terminal:!!process.stdin.isTTY});
process.stderr.write('Family password (hidden): ');
terminal.question('',password=>{
  terminal.close(); process.stderr.write('\n');
  if(password.length<12){process.stderr.write('Use at least 12 characters.\n');process.exitCode=1;return;}
  process.stdout.write(passwordHash(password)+'\n');
});
