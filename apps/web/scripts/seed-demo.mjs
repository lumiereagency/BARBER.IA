const { prisma } = await import("@barber/db");
await prisma.barbershop.deleteMany({ where: { slug: "barbearia-do-ze" } });
const shop = await prisma.barbershop.create({
  data: {
    name: "Barbearia do Zé", slug: "barbearia-do-ze", timezone: "America/Sao_Paulo",
    phone: "+5511987654321", slotGranularityMinutes: 30, bookingWindowDays: 60,
    cancellationPolicy: "Cancele com até 2 horas de antecedência.",
    address: { district: "Vila Madalena", city: "São Paulo" },
  },
});
const pro = await prisma.professional.create({
  data: { barbershopId: shop.id, displayName: "Matheus", bookingPriority: 1 },
});
const pro2 = await prisma.professional.create({
  data: { barbershopId: shop.id, displayName: "Rafael", bookingPriority: 2 },
});
const corte = await prisma.service.create({
  data: { barbershopId: shop.id, name: "Corte", priceMinor: 5000, durationMinutes: 30, bufferAfterMinutes: 10, publicOrder: 1 },
});
const combo = await prisma.service.create({
  data: { barbershopId: shop.id, name: "Corte + Barba", priceMinor: 8000, durationMinutes: 60, bufferAfterMinutes: 10, publicOrder: 2 },
});
for (const p of [pro, pro2]) {
  for (const s of [corte, combo]) {
    await prisma.professionalService.create({ data: { barbershopId: shop.id, professionalId: p.id, serviceId: s.id } });
  }
  for (let weekday = 1; weekday <= 6; weekday++) {
    await prisma.workingHours.create({
      data: { barbershopId: shop.id, professionalId: p.id, weekday, startLocalTime: "09:00", endLocalTime: "18:00" },
    });
  }
}
console.log("semeado:", shop.slug);
await prisma.$disconnect();
