// PeerJS 연결만 맡는다. 방 코드로 만나고, 메시지 내용은 모른다.
(function (root) {
  const PREFIX = 'hover-race-manager-';
  const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const makeCode = () => Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
  const usable = () => typeof root.Peer !== 'undefined';

  // 방장. handlers: ready(code), open(conn), data(conn, msg), close(conn), error(text)
  // code를 주면 그 방 코드를 다시 연다(이어 하기).
  function host(handlers, tries = 0, wanted = null) {
    if (!usable()) return handlers.error('연결 도구를 못 불러왔어. 인터넷을 확인해 줘.');
    const code = wanted || makeCode();
    const peer = new root.Peer(PREFIX + code);
    peer.on('open', () => handlers.ready(code));
    peer.on('connection', (conn) => {
      conn.on('open', () => handlers.open(conn));
      conn.on('data', (msg) => handlers.data(conn, msg));
      conn.on('close', () => handlers.close(conn));
      conn.on('error', () => handlers.close(conn));
    });
    peer.on('disconnected', () => peer.reconnect());
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id' && wanted) handlers.error('그 방 코드가 아직 쓰이고 있어. 잠시 뒤에 다시 해 줘.');
      else if (e.type === 'unavailable-id' && tries < 5) host(handlers, tries + 1);
      else if (e.type !== 'peer-unavailable') handlers.error('연결에 문제가 생겼어: ' + e.type);
    });
    return peer;
  }

  // 손님. handlers: open(conn), data(msg), close(), error(text)
  function join(code, handlers) {
    if (!usable()) return handlers.error('연결 도구를 못 불러왔어. 인터넷을 확인해 줘.');
    const peer = new root.Peer();
    const connect = () => {
      const conn = peer.connect(PREFIX + code.toUpperCase(), { reliable: true, serialization: 'json' });
      conn.on('open', () => handlers.open(conn));
      conn.on('data', handlers.data);
      conn.on('close', handlers.close);
    };
    peer.on('open', connect);
    peer.on('disconnected', () => peer.reconnect());
    peer.on('error', (e) => handlers.error(e.type === 'peer-unavailable' ? '그 방을 못 찾았어. 코드를 확인해 줘.' : '연결에 문제가 생겼어: ' + e.type));
    return { peer, connect };
  }

  root.HoverNet = { host, join };
})(window);
