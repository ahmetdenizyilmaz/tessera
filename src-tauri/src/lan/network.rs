//! LAN sockets must not outlive Tessera through a spawned terminal/app-server.
//! Mio's Windows socket() path creates inheritable handles. socket2 sets
//! WSA_FLAG_NO_HANDLE_INHERIT at creation, before any child can inherit them.
use std::{io, net::SocketAddr};
use socket2::{Domain, Protocol, Socket, Type};
use tokio::net::{TcpListener, TcpSocket, TcpStream};

fn socket(address: SocketAddr) -> io::Result<Socket> {
    let socket = Socket::new(Domain::for_address(address), Type::STREAM, Some(Protocol::TCP))?;
    socket.set_nonblocking(true)?;
    Ok(socket)
}

pub fn listen(address: SocketAddr) -> io::Result<TcpListener> {
    let socket = socket(address)?;
    socket.bind(&address.into())?;
    socket.listen(128)?;
    TcpListener::from_std(socket.into())
}

pub async fn connect(address: SocketAddr) -> io::Result<TcpStream> {
    TcpSocket::from_std_stream(socket(address)?.into()).connect(address).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    fn assert_not_inherited(socket: &impl std::os::windows::io::AsRawSocket) {
        #[link(name = "kernel32")]
        extern "system" { fn GetHandleInformation(handle: isize, flags: *mut u32) -> i32; }
        let mut flags = 0;
        assert_ne!(unsafe { GetHandleInformation(socket.as_raw_socket() as isize, &mut flags) }, 0);
        assert_eq!(flags & 1, 0, "LAN handles must not be inherited by agent processes");
    }

    #[tokio::test]
    async fn listener_and_both_streams_do_not_leak_into_child_processes() {
        let listener = listen("127.0.0.1:0".parse().unwrap()).unwrap();
        let (client, accepted) = tokio::join!(connect(listener.local_addr().unwrap()), listener.accept());
        let client = client.unwrap();
        let (server, _) = accepted.unwrap();
        #[cfg(windows)] {
            assert_not_inherited(&listener);
            assert_not_inherited(&client);
            assert_not_inherited(&server);
        }
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let (mut client, mut server) = (client, server);
        client.write_all(b"ready").await.unwrap();
        let mut data = [0; 5];
        server.read_exact(&mut data).await.unwrap();
        assert_eq!(&data, b"ready");
    }

    #[tokio::test]
    async fn occupied_port_fails_and_can_be_retried_after_release() {
        let first = listen("127.0.0.1:0".parse().unwrap()).unwrap();
        let address = first.local_addr().unwrap();
        assert!(listen(address).is_err());
        drop(first);
        let second = listen(address).unwrap();
        assert_eq!(second.local_addr().unwrap(), address);
    }
}
