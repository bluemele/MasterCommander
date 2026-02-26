export default function Background({ variant = 'default' }) {
  const configs = {
    default: [
      { size: 400, x: '10%', y: '20%', color: 'rgba(123,104,238,0.15)', duration: '20s' },
      { size: 300, x: '70%', y: '60%', color: 'rgba(212,168,83,0.1)', duration: '25s' },
      { size: 250, x: '50%', y: '10%', color: 'rgba(110,184,156,0.08)', duration: '22s' },
    ],
    warm: [
      { size: 500, x: '20%', y: '30%', color: 'rgba(212,168,83,0.12)', duration: '20s' },
      { size: 350, x: '75%', y: '50%', color: 'rgba(224,120,136,0.1)', duration: '24s' },
      { size: 300, x: '40%', y: '80%', color: 'rgba(123,104,238,0.08)', duration: '28s' },
    ],
    calm: [
      { size: 450, x: '15%', y: '40%', color: 'rgba(110,184,156,0.12)', duration: '22s' },
      { size: 350, x: '65%', y: '20%', color: 'rgba(123,104,238,0.1)', duration: '26s' },
      { size: 280, x: '80%', y: '70%', color: 'rgba(212,168,83,0.08)', duration: '30s' },
    ],
    focus: [
      { size: 600, x: '50%', y: '50%', color: 'rgba(123,104,238,0.1)', duration: '30s' },
      { size: 300, x: '20%', y: '20%', color: 'rgba(212,168,83,0.06)', duration: '22s' },
    ],
  };

  const orbs = configs[variant] || configs.default;

  return (
    <div className="bg-gradient">
      {orbs.map((orb, i) => (
        <div
          key={i}
          className="bg-orb"
          style={{
            width: orb.size,
            height: orb.size,
            left: orb.x,
            top: orb.y,
            background: orb.color,
            animation: `float ${orb.duration} ease-in-out infinite, pulse-soft ${orb.duration} ease-in-out infinite`,
            animationDelay: `${i * 2}s`,
            transform: 'translate(-50%, -50%)',
          }}
        />
      ))}
    </div>
  );
}
