import {marked} from 'marked';
import {markedTerminal} from 'marked-terminal';

marked.use(markedTerminal());
let x= marked.parse('# Hello \n This is **markdown** printed in the `terminal`');
console.log(x);
console.log("!done")


